import { invariant } from '@zenstackhq/common-helpers';
import {
    AliasNode,
    BinaryOperationNode,
    ColumnNode,
    expressionBuilder,
    FromNode,
    FunctionNode,
    IdentifierNode,
    OperatorNode,
    ReferenceNode,
    SelectionNode,
    SelectQueryNode,
    TableNode,
    ValueListNode,
    ValueNode,
    WhereNode,
    type ExpressionBuilder,
    type OperandExpression,
    type OperationNode,
} from 'kysely';
import { match } from 'ts-pattern';
import type { ClientContract, CRUD } from '../../client/contract';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base-dialect';
import { InternalError, QueryError } from '../../client/errors';
import { getModel, getRelationForeignKeyFieldPairs, requireField, requireIdFields } from '../../client/query-utils';
import type {
    BinaryExpression,
    BinaryOperator,
    BuiltinType,
    FieldDef,
    GetModels,
    LiteralExpression,
    MemberExpression,
    UnaryExpression,
} from '../../schema';
import {
    ExpressionUtils,
    type ArrayExpression,
    type CallExpression,
    type Expression,
    type FieldExpression,
    type SchemaDef,
} from '../../schema';
import { ExpressionEvaluator } from './expression-evaluator';
import { conjunction, disjunction, logicalNot, trueNode } from './utils';

export type ExpressionTransformerContext<Schema extends SchemaDef> = {
    model: GetModels<Schema>;
    alias?: string;
    operation: CRUD;
    auth?: any;
    memberFilter?: OperationNode;
    memberSelect?: SelectionNode;
};

// a registry of expression handlers marked with @expr
const expressionHandlers = new Map<string, PropertyDescriptor>();

// expression handler decorator
function expr(kind: Expression['kind']) {
    return function (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) {
        if (!expressionHandlers.get(kind)) {
            expressionHandlers.set(kind, descriptor);
        }
        return descriptor;
    };
}

export class ExpressionTransformer<Schema extends SchemaDef> {
    private readonly dialect: BaseCrudDialect<Schema>;

    constructor(private readonly client: ClientContract<Schema>) {
        this.dialect = getCrudDialect(this.schema, this.clientOptions);
    }

    get schema() {
        return this.client.$schema;
    }

    get clientOptions() {
        return this.client.$options;
    }

    get auth() {
        return this.client.$auth;
    }

    get authType() {
        if (!this.schema.authType) {
            throw new InternalError('Schema does not have an "authType" specified');
        }
        return this.schema.authType!;
    }

    transform(expression: Expression, context: ExpressionTransformerContext<Schema>): OperationNode {
        const handler = expressionHandlers.get(expression.kind);
        if (!handler) {
            throw new Error(`Unsupported expression kind: ${expression.kind}`);
        }
        return handler.value.call(this, expression, context);
    }

    @expr('literal')
    // @ts-expect-error
    private _literal(expr: LiteralExpression) {
        return this.transformValue(
            expr.value,
            typeof expr.value === 'string' ? 'String' : typeof expr.value === 'boolean' ? 'Boolean' : 'Int',
        );
    }

    @expr('array')
    // @ts-expect-error
    private _array(expr: ArrayExpression, context: ExpressionTransformerContext<Schema>) {
        return ValueListNode.create(expr.items.map((item) => this.transform(item, context)));
    }

    @expr('field')
    private _field(expr: FieldExpression, context: ExpressionTransformerContext<Schema>) {
        const fieldDef = requireField(this.schema, context.model, expr.field);
        if (!fieldDef.relation) {
            return this.createColumnRef(expr.field, context);
        } else {
            const { memberFilter, memberSelect, ...restContext } = context;
            const relation = this.transformRelationAccess(expr.field, fieldDef.type, restContext);
            return {
                ...relation,
                where: this.mergeWhere(relation.where, memberFilter),
                selections: memberSelect ? [memberSelect] : relation.selections,
            };
        }
    }

    private mergeWhere(where: WhereNode | undefined, memberFilter: OperationNode | undefined) {
        if (!where) {
            return WhereNode.create(memberFilter ?? trueNode(this.dialect));
        }
        if (!memberFilter) {
            return where;
        }
        return WhereNode.create(conjunction(this.dialect, [where.where, memberFilter]));
    }

    @expr('null')
    // @ts-ignore
    private _null() {
        return ValueNode.createImmediate(null);
    }

    @expr('binary')
    // @ts-ignore
    private _binary(expr: BinaryExpression, context: ExpressionTransformerContext<Schema>) {
        if (expr.op === '&&') {
            return conjunction(this.dialect, [this.transform(expr.left, context), this.transform(expr.right, context)]);
        } else if (expr.op === '||') {
            return disjunction(this.dialect, [this.transform(expr.left, context), this.transform(expr.right, context)]);
        }

        if (this.isAuthCall(expr.left) || this.isAuthCall(expr.right)) {
            return this.transformAuthBinary(expr, context);
        }

        const op = expr.op;

        if (op === '?' || op === '!' || op === '^') {
            return this.transformCollectionPredicate(expr, context);
        }

        const { normalizedLeft, normalizedRight } = this.normalizeBinaryOperationOperands(expr, context);
        const left = this.transform(normalizedLeft, context);
        const right = this.transform(normalizedRight, context);

        if (op === 'in') {
            if (this.isNullNode(left)) {
                return this.transformValue(false, 'Boolean');
            } else {
                if (ValueListNode.is(right)) {
                    return BinaryOperationNode.create(left, OperatorNode.create('in'), right);
                } else {
                    // array contains
                    return BinaryOperationNode.create(
                        left,
                        OperatorNode.create('='),
                        FunctionNode.create('any', [right]),
                    );
                }
            }
        }

        if (this.isNullNode(right)) {
            return expr.op === '=='
                ? BinaryOperationNode.create(left, OperatorNode.create('is'), right)
                : BinaryOperationNode.create(left, OperatorNode.create('is not'), right);
        } else if (this.isNullNode(left)) {
            return expr.op === '=='
                ? BinaryOperationNode.create(right, OperatorNode.create('is'), ValueNode.createImmediate(null))
                : BinaryOperationNode.create(right, OperatorNode.create('is not'), ValueNode.createImmediate(null));
        }

        return BinaryOperationNode.create(left, this.transformOperator(op), right);
    }

    private normalizeBinaryOperationOperands(expr: BinaryExpression, context: ExpressionTransformerContext<Schema>) {
        // if relation fields are used directly in comparison, it can only be compared with null,
        // so we normalize the args with the id field (use the first id field if multiple)
        let normalizedLeft: Expression = expr.left;
        if (this.isRelationField(expr.left, context.model)) {
            invariant(ExpressionUtils.isNull(expr.right), 'only null comparison is supported for relation field');
            const idFields = requireIdFields(this.schema, context.model);
            normalizedLeft = this.makeOrAppendMember(normalizedLeft, idFields[0]!);
        }
        let normalizedRight: Expression = expr.right;
        if (this.isRelationField(expr.right, context.model)) {
            invariant(ExpressionUtils.isNull(expr.left), 'only null comparison is supported for relation field');
            const idFields = requireIdFields(this.schema, context.model);
            normalizedRight = this.makeOrAppendMember(normalizedRight, idFields[0]!);
        }
        return { normalizedLeft, normalizedRight };
    }

    private transformCollectionPredicate(expr: BinaryExpression, context: ExpressionTransformerContext<Schema>) {
        invariant(expr.op === '?' || expr.op === '!' || expr.op === '^', 'expected "?" or "!" or "^" operator');

        if (this.isAuthCall(expr.left) || this.isAuthMember(expr.left)) {
            const value = new ExpressionEvaluator().evaluate(expr, {
                auth: this.auth,
            });
            return this.transformValue(value, 'Boolean');
        }

        invariant(
            ExpressionUtils.isField(expr.left) || ExpressionUtils.isMember(expr.left),
            'left operand must be field or member access',
        );

        let newContextModel: string;
        const fieldDef = this.getFieldDefFromFieldRef(expr.left, context.model);
        if (fieldDef) {
            invariant(fieldDef.relation, `field is not a relation: ${JSON.stringify(expr.left)}`);
            newContextModel = fieldDef.type;
        } else {
            invariant(
                ExpressionUtils.isMember(expr.left) && ExpressionUtils.isField(expr.left.receiver),
                'left operand must be member access with field receiver',
            );
            const fieldDef = requireField(this.schema, context.model, expr.left.receiver.field);
            newContextModel = fieldDef.type;
            for (const member of expr.left.members) {
                const memberDef = requireField(this.schema, newContextModel, member);
                newContextModel = memberDef.type;
            }
        }

        let predicateFilter = this.transform(expr.right, {
            ...context,
            model: newContextModel as GetModels<Schema>,
            alias: undefined,
        });

        if (expr.op === '!') {
            predicateFilter = logicalNot(this.dialect, predicateFilter);
        }

        const count = FunctionNode.create('count', [ValueNode.createImmediate(1)]);

        const predicateResult = match(expr.op)
            .with('?', () => BinaryOperationNode.create(count, OperatorNode.create('>'), ValueNode.createImmediate(0)))
            .with('!', () => BinaryOperationNode.create(count, OperatorNode.create('='), ValueNode.createImmediate(0)))
            .with('^', () => BinaryOperationNode.create(count, OperatorNode.create('='), ValueNode.createImmediate(0)))
            .exhaustive();

        return this.transform(expr.left, {
            ...context,
            memberSelect: SelectionNode.create(AliasNode.create(predicateResult, IdentifierNode.create('$t'))),
            memberFilter: predicateFilter,
        });
    }

    private transformAuthBinary(expr: BinaryExpression, context: ExpressionTransformerContext<Schema>) {
        if (expr.op !== '==' && expr.op !== '!=') {
            throw new QueryError(
                `Unsupported operator for \`auth()\` in policy of model "${context.model}": ${expr.op}`,
            );
        }

        let authExpr: Expression;
        let other: Expression;
        if (this.isAuthCall(expr.left)) {
            authExpr = expr.left;
            other = expr.right;
        } else {
            authExpr = expr.right;
            other = expr.left;
        }

        if (ExpressionUtils.isNull(other)) {
            return this.transformValue(expr.op === '==' ? !this.auth : !!this.auth, 'Boolean');
        } else {
            const authModel = getModel(this.schema, this.authType);
            if (!authModel) {
                throw new QueryError(
                    `Unsupported use of \`auth()\` in policy of model "${context.model}", comparing with \`auth()\` is only possible when auth type is a model`,
                );
            }

            const idFields = Object.values(authModel.fields)
                .filter((f) => f.id)
                .map((f) => f.name);
            invariant(idFields.length > 0, 'auth type model must have at least one id field');

            // convert `auth() == other` into `auth().id == other.id`
            const conditions = idFields.map((fieldName) =>
                ExpressionUtils.binary(
                    ExpressionUtils.member(authExpr, [fieldName]),
                    '==',
                    this.makeOrAppendMember(other, fieldName),
                ),
            );
            let result = this.buildAnd(conditions);
            if (expr.op === '!=') {
                result = this.buildLogicalNot(result);
            }
            return this.transform(result, context);
        }
    }

    private makeOrAppendMember(other: Expression, fieldName: string): Expression {
        if (ExpressionUtils.isMember(other)) {
            return ExpressionUtils.member(other.receiver, [...other.members, fieldName]);
        } else {
            return ExpressionUtils.member(other, [fieldName]);
        }
    }

    private transformValue(value: unknown, type: BuiltinType) {
        return ValueNode.create(this.dialect.transformPrimitive(value, type, false) ?? null);
    }

    @expr('unary')
    // @ts-ignore
    private _unary(expr: UnaryExpression, context: ExpressionTransformerContext<Schema>) {
        // only '!' operator for now
        invariant(expr.op === '!', 'only "!" operator is supported');
        return logicalNot(this.dialect, this.transform(expr.operand, context));
    }

    private transformOperator(op: Exclude<BinaryOperator, '?' | '!' | '^'>) {
        const mappedOp = match(op)
            .with('==', () => '=' as const)
            .otherwise(() => op);
        return OperatorNode.create(mappedOp);
    }

    @expr('call')
    // @ts-ignore
    private _call(expr: CallExpression, context: ExpressionTransformerContext<Schema>) {
        const result = this.transformCall(expr, context);
        return result.toOperationNode();
    }

    private transformCall(expr: CallExpression, context: ExpressionTransformerContext<Schema>) {
        const func = this.getFunctionImpl(expr.function);
        if (!func) {
            throw new QueryError(`Function not implemented: ${expr.function}`);
        }
        const eb = expressionBuilder<any, any>();
        return func(
            eb,
            (expr.args ?? []).map((arg) => this.transformCallArg(eb, arg, context)),
            {
                client: this.client,
                dialect: this.dialect,
                model: context.model,
                modelAlias: context.alias ?? context.model,
                operation: context.operation,
            },
        );
    }

    private getFunctionImpl(functionName: string) {
        // check built-in functions
        let func = this.clientOptions.functions?.[functionName];
        if (!func) {
            // check plugins
            for (const plugin of this.clientOptions.plugins ?? []) {
                if (plugin.functions?.[functionName]) {
                    func = plugin.functions[functionName];
                    break;
                }
            }
        }
        return func;
    }

    private transformCallArg(
        eb: ExpressionBuilder<any, any>,
        arg: Expression,
        context: ExpressionTransformerContext<Schema>,
    ): OperandExpression<any> {
        if (ExpressionUtils.isLiteral(arg)) {
            return eb.val(arg.value);
        }

        if (ExpressionUtils.isField(arg)) {
            return eb.ref(arg.field);
        }

        if (ExpressionUtils.isCall(arg)) {
            return this.transformCall(arg, context);
        }

        if (this.isAuthMember(arg)) {
            const valNode = this.valueMemberAccess(context.auth, arg as MemberExpression, this.authType);
            return valNode ? eb.val(valNode.value) : eb.val(null);
        }

        // TODO
        // if (Expression.isMember(arg)) {
        // }

        throw new InternalError(`Unsupported argument expression: ${arg.kind}`);
    }

    @expr('member')
    // @ts-ignore
    private _member(expr: MemberExpression, context: ExpressionTransformerContext<Schema>) {
        // auth() member access
        if (this.isAuthCall(expr.receiver)) {
            return this.valueMemberAccess(this.auth, expr, this.authType);
        }

        invariant(
            ExpressionUtils.isField(expr.receiver) || ExpressionUtils.isThis(expr.receiver),
            'expect receiver to be field expression or "this"',
        );

        let members = expr.members;
        let receiver: OperationNode;
        const { memberFilter, memberSelect, ...restContext } = context;

        if (ExpressionUtils.isThis(expr.receiver)) {
            if (expr.members.length === 1) {
                // `this.relation` case, equivalent to field access
                return this._field(ExpressionUtils.field(expr.members[0]!), context);
            } else {
                // transform the first segment into a relation access, then continue with the rest of the members
                const firstMemberFieldDef = requireField(this.schema, context.model, expr.members[0]!);
                receiver = this.transformRelationAccess(expr.members[0]!, firstMemberFieldDef.type, restContext);
                members = expr.members.slice(1);
            }
        } else {
            receiver = this.transform(expr.receiver, restContext);
        }

        invariant(SelectQueryNode.is(receiver), 'expected receiver to be select query');

        let startType: string;
        if (ExpressionUtils.isField(expr.receiver)) {
            const receiverField = requireField(this.schema, context.model, expr.receiver.field);
            startType = receiverField.type;
        } else {
            // "this." case, start type is the model of the context
            startType = context.model;
        }

        // traverse forward to collect member types
        const memberFields: { fromModel: string; fieldDef: FieldDef }[] = [];
        let currType = startType;
        for (const member of members) {
            const fieldDef = requireField(this.schema, currType, member);
            memberFields.push({ fieldDef, fromModel: currType });
            currType = fieldDef.type;
        }

        let currNode: SelectQueryNode | ColumnNode | ReferenceNode | undefined = undefined;

        for (let i = members.length - 1; i >= 0; i--) {
            const member = members[i]!;
            const { fieldDef, fromModel } = memberFields[i]!;

            if (fieldDef.relation) {
                const relation = this.transformRelationAccess(member, fieldDef.type, {
                    ...restContext,
                    model: fromModel as GetModels<Schema>,
                    alias: undefined,
                });

                if (currNode) {
                    invariant(SelectQueryNode.is(currNode), 'expected select query node');
                    currNode = {
                        ...relation,
                        selections: [
                            SelectionNode.create(AliasNode.create(currNode, IdentifierNode.create(members[i + 1]!))),
                        ],
                    };
                } else {
                    // inner most member, merge with member filter from the context
                    currNode = {
                        ...relation,
                        where: this.mergeWhere(relation.where, memberFilter),
                        selections: memberSelect ? [memberSelect] : relation.selections,
                    };
                }
            } else {
                invariant(i === members.length - 1, 'plain field access must be the last segment');
                invariant(!currNode, 'plain field access must be the last segment');

                currNode = ColumnNode.create(member);
            }
        }

        return {
            ...receiver,
            selections: [SelectionNode.create(AliasNode.create(currNode!, IdentifierNode.create('$t')))],
        };
    }

    private valueMemberAccess(receiver: any, expr: MemberExpression, receiverType: string) {
        if (!receiver) {
            return ValueNode.createImmediate(null);
        }

        if (expr.members.length !== 1) {
            throw new Error(`Only single member access is supported`);
        }

        const field = expr.members[0]!;
        const fieldDef = requireField(this.schema, receiverType, field);
        const fieldValue = receiver[field] ?? null;
        return this.transformValue(fieldValue, fieldDef.type as BuiltinType);
    }

    private transformRelationAccess(
        field: string,
        relationModel: string,
        context: ExpressionTransformerContext<Schema>,
    ): SelectQueryNode {
        const fromModel = context.model;
        const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(this.schema, fromModel, field);

        let condition: OperationNode;
        if (ownedByModel) {
            // `fromModel` owns the fk
            condition = conjunction(
                this.dialect,
                keyPairs.map(({ fk, pk }) =>
                    BinaryOperationNode.create(
                        ReferenceNode.create(ColumnNode.create(fk), TableNode.create(context.alias ?? fromModel)),
                        OperatorNode.create('='),
                        ReferenceNode.create(ColumnNode.create(pk), TableNode.create(relationModel)),
                    ),
                ),
            );
        } else {
            // `relationModel` owns the fk
            condition = conjunction(
                this.dialect,
                keyPairs.map(({ fk, pk }) =>
                    BinaryOperationNode.create(
                        ReferenceNode.create(ColumnNode.create(pk), TableNode.create(context.alias ?? fromModel)),
                        OperatorNode.create('='),
                        ReferenceNode.create(ColumnNode.create(fk), TableNode.create(relationModel)),
                    ),
                ),
            );
        }

        return {
            kind: 'SelectQueryNode',
            from: FromNode.create([TableNode.create(relationModel)]),
            where: WhereNode.create(condition),
        };
    }

    private createColumnRef(column: string, context: ExpressionTransformerContext<Schema>): ReferenceNode {
        return ReferenceNode.create(ColumnNode.create(column), TableNode.create(context.alias ?? context.model));
    }

    private isAuthCall(value: unknown): value is CallExpression {
        return ExpressionUtils.isCall(value) && value.function === 'auth';
    }

    private isAuthMember(expr: Expression) {
        return ExpressionUtils.isMember(expr) && this.isAuthCall(expr.receiver);
    }

    private isNullNode(node: OperationNode) {
        return ValueNode.is(node) && node.value === null;
    }

    private buildLogicalNot(result: Expression): Expression {
        return ExpressionUtils.unary('!', result);
    }

    private buildAnd(conditions: BinaryExpression[]): Expression {
        if (conditions.length === 0) {
            return ExpressionUtils.literal(true);
        } else if (conditions.length === 1) {
            return conditions[0]!;
        } else {
            return conditions.reduce((acc, condition) => ExpressionUtils.binary(acc, '&&', condition));
        }
    }

    private isRelationField(expr: Expression, model: GetModels<Schema>) {
        const fieldDef = this.getFieldDefFromFieldRef(expr, model);
        return !!fieldDef?.relation;
    }

    private getFieldDefFromFieldRef(expr: Expression, model: GetModels<Schema>): FieldDef | undefined {
        if (ExpressionUtils.isField(expr)) {
            return requireField(this.schema, model, expr.field);
        } else if (
            ExpressionUtils.isMember(expr) &&
            expr.members.length === 1 &&
            ExpressionUtils.isThis(expr.receiver)
        ) {
            return requireField(this.schema, model, expr.members[0]!);
        } else {
            return undefined;
        }
    }
}
