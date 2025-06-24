import { invariant } from '@zenstackhq/common-helpers';
import type { OperandExpression } from 'kysely';
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
    type OperationNode,
} from 'kysely';
import { match } from 'ts-pattern';
import type { CRUD } from '../../client/contract';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base';
import { InternalError, QueryError } from '../../client/errors';
import type { ClientOptions } from '../../client/options';
import { getRelationForeignKeyFieldPairs, requireField } from '../../client/query-utils';
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
    thisEntity?: Record<string, OperationNode>;
    thisEntityRaw?: Record<string, unknown>;
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

    constructor(
        private readonly schema: Schema,
        private readonly clientOptions: ClientOptions<Schema>,
        private readonly auth: unknown | undefined,
    ) {
        this.dialect = getCrudDialect(this.schema, this.clientOptions);
    }

    get authType() {
        if (!this.schema.authType) {
            throw new InternalError('Schema does not have an "authType" specified');
        }
        return this.schema.authType;
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
    // @ts-expect-error
    private _field(expr: FieldExpression, context: ExpressionTransformerContext<Schema>) {
        const fieldDef = requireField(this.schema, context.model, expr.field);
        if (!fieldDef.relation) {
            if (context.thisEntity) {
                return context.thisEntity[expr.field];
            } else {
                return this.createColumnRef(expr.field, context);
            }
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
            return this.transformAuthBinary(expr);
        }

        const op = expr.op;

        if (op === '?' || op === '!' || op === '^') {
            return this.transformCollectionPredicate(expr, context);
        }

        const left = this.transform(expr.left, context);
        const right = this.transform(expr.right, context);

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
        if (ExpressionUtils.isField(expr.left)) {
            const fieldDef = requireField(this.schema, context.model, expr.left.field);
            newContextModel = fieldDef.type;
        } else {
            invariant(ExpressionUtils.isField(expr.left.receiver));
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
            thisEntity: undefined,
        });

        if (expr.op === '!') {
            predicateFilter = logicalNot(predicateFilter);
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

    private transformAuthBinary(expr: BinaryExpression) {
        if (expr.op !== '==' && expr.op !== '!=') {
            throw new Error(`Unsupported operator for auth call: ${expr.op}`);
        }
        let other: Expression;
        if (this.isAuthCall(expr.left)) {
            other = expr.right;
        } else {
            other = expr.left;
        }

        if (ExpressionUtils.isNull(other)) {
            return this.transformValue(expr.op === '==' ? !this.auth : !!this.auth, 'Boolean');
        } else {
            throw new Error('Unsupported binary expression with `auth()`');
        }
    }

    private transformValue(value: unknown, type: BuiltinType) {
        return ValueNode.create(this.dialect.transformPrimitive(value, type) ?? null);
    }

    @expr('unary')
    // @ts-ignore
    private _unary(expr: UnaryExpression, context: ExpressionTransformerContext<Schema>) {
        // only '!' operator for now
        invariant(expr.op === '!', 'only "!" operator is supported');
        return BinaryOperationNode.create(
            this.transform(expr.operand, context),
            this.transformOperator('!='),
            trueNode(this.dialect),
        );
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
        const func = this.clientOptions.functions?.[expr.function];
        if (!func) {
            throw new QueryError(`Function not implemented: ${expr.function}`);
        }
        const eb = expressionBuilder<any, any>();
        return func(
            eb,
            (expr.args ?? []).map((arg) => this.transformCallArg(eb, arg, context)),
            {
                dialect: this.dialect,
                model: context.model,
                operation: context.operation,
            },
        );
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
            return context.thisEntityRaw ? eb.val(context.thisEntityRaw[arg.field]) : eb.ref(arg.field);
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

        invariant(ExpressionUtils.isField(expr.receiver), 'expect receiver to be field expression');

        const { memberFilter, memberSelect, ...restContext } = context;

        const receiver = this.transform(expr.receiver, restContext);
        invariant(SelectQueryNode.is(receiver), 'expected receiver to be select query');

        // relation member access
        const receiverField = requireField(this.schema, context.model, expr.receiver.field);

        // traverse forward to collect member types
        const memberFields: { fromModel: string; fieldDef: FieldDef }[] = [];
        let currType = receiverField.type;
        for (const member of expr.members) {
            const fieldDef = requireField(this.schema, currType, member);
            memberFields.push({ fieldDef, fromModel: currType });
            currType = fieldDef.type;
        }

        let currNode: SelectQueryNode | ColumnNode | ReferenceNode | undefined = undefined;

        for (let i = expr.members.length - 1; i >= 0; i--) {
            const member = expr.members[i]!;
            const { fieldDef, fromModel } = memberFields[i]!;

            if (fieldDef.relation) {
                const relation = this.transformRelationAccess(member, fieldDef.type, {
                    ...restContext,
                    model: fromModel as GetModels<Schema>,
                    alias: undefined,
                    thisEntity: undefined,
                });

                if (currNode) {
                    invariant(SelectQueryNode.is(currNode), 'expected select query node');
                    currNode = {
                        ...relation,
                        selections: [
                            SelectionNode.create(
                                AliasNode.create(currNode, IdentifierNode.create(expr.members[i + 1]!)),
                            ),
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
                invariant(i === expr.members.length - 1, 'plain field access must be the last segment');
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

        if (context.thisEntity) {
            let condition: OperationNode;
            if (ownedByModel) {
                condition = conjunction(
                    this.dialect,
                    keyPairs.map(({ fk, pk }) =>
                        BinaryOperationNode.create(
                            ReferenceNode.create(ColumnNode.create(pk), TableNode.create(relationModel)),
                            OperatorNode.create('='),
                            context.thisEntity![fk]!,
                        ),
                    ),
                );
            } else {
                condition = conjunction(
                    this.dialect,
                    keyPairs.map(({ fk, pk }) =>
                        BinaryOperationNode.create(
                            ReferenceNode.create(ColumnNode.create(fk), TableNode.create(relationModel)),
                            OperatorNode.create('='),
                            context.thisEntity![pk]!,
                        ),
                    ),
                );
            }

            return {
                kind: 'SelectQueryNode',
                from: FromNode.create([TableNode.create(relationModel)]),
                where: WhereNode.create(condition),
            };
        } else {
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
}
