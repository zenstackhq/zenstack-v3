import {
    AliasNode,
    BinaryOperationNode,
    ColumnNode,
    FromNode,
    FunctionNode,
    IdentifierNode,
    OperatorNode,
    ReferenceNode,
    SelectionNode,
    SelectQueryNode,
    TableNode,
    ValueNode,
    WhereNode,
    type OperationNode,
} from 'kysely';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { FieldDef } from '../../../dist/schema';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base';
import { InternalError, QueryError } from '../../client/errors';
import type { ClientOptions } from '../../client/options';
import {
    getRelationForeignKeyFieldPairs,
    requireField,
} from '../../client/query-utils';
import type { CallExpression, FieldExpression, SchemaDef } from '../../schema';
import {
    Expression,
    type BinaryExpression,
    type BinaryOperator,
    type LiteralExpression,
    type MemberExpression,
    type UnaryExpression,
} from '../../schema/expression';
import type { BuiltinType, GetModels } from '../../schema/schema';
import { conjunction, disjunction, logicalNot, trueNode } from './utils';

export type ExpressionTransformerContext<Schema extends SchemaDef> = {
    model: GetModels<Schema>;
    thisEntity?: Record<string, OperationNode>;
};

// a registry of expression handlers marked with @expr
const expressionHandlers = new Map<string, PropertyDescriptor>();

// expression handler decorator
function expr(kind: Expression['kind']) {
    return function (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
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
        private readonly auth: unknown | undefined
    ) {
        this.dialect = getCrudDialect(this.schema, this.clientOptions);
    }

    get authType() {
        if (!this.schema.authType) {
            throw new InternalError(
                'Schema does not have an "authType" specified'
            );
        }
        return this.schema.authType;
    }

    transform(
        expression: Expression,
        context: ExpressionTransformerContext<Schema>
    ): OperationNode {
        const handler = expressionHandlers.get(expression.kind);
        if (!handler) {
            throw new Error(`Unsupported expression kind: ${expression.kind}`);
        }
        return handler.value.call(this, expression, context);
    }

    @expr('literal')
    // @ts-ignore
    private _literal(expr: LiteralExpression) {
        return this.transformValue(
            expr.value,
            typeof expr.value === 'string'
                ? 'String'
                : typeof expr.value === 'boolean'
                ? 'Boolean'
                : 'Int'
        );
    }

    @expr('field')
    // @ts-ignore
    private _field(
        expr: FieldExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        const fieldDef = requireField(this.schema, context.model, expr.field);
        if (!fieldDef.relation) {
            if (context.thisEntity) {
                return context.thisEntity[expr.field];
            } else {
                return ColumnNode.create(expr.field);
            }
        } else {
            return this._relation(
                context.model,
                expr.field,
                fieldDef.type,
                context
            );
        }
    }

    @expr('null')
    // @ts-ignore
    private _null() {
        return ValueNode.create(null);
    }

    @expr('binary')
    // @ts-ignore
    private _binary(
        expr: BinaryExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        if (expr.op === '&&') {
            return conjunction(this.dialect, [
                this.transform(expr.left, context),
                this.transform(expr.right, context),
            ]);
        } else if (expr.op === '||') {
            return disjunction(this.dialect, [
                this.transform(expr.left, context),
                this.transform(expr.right, context),
            ]);
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

        if (this.isNullNode(right)) {
            invariant(
                expr.op === '==' || expr.op === '!=',
                'Comparison with null must be "==" or "!="'
            );
            return expr.op === '=='
                ? BinaryOperationNode.create(
                      left,
                      OperatorNode.create('is'),
                      right
                  )
                : BinaryOperationNode.create(
                      left,
                      OperatorNode.create('is not'),
                      right
                  );
        } else if (this.isNullNode(left)) {
            invariant(
                expr.op === '==' || expr.op === '!=',
                'Comparison with null must be "==" or "!="'
            );
            return expr.op === '=='
                ? BinaryOperationNode.create(
                      right,
                      OperatorNode.create('is'),
                      left
                  )
                : BinaryOperationNode.create(
                      right,
                      OperatorNode.create('is not'),
                      left
                  );
        }

        return BinaryOperationNode.create(
            left,
            this.transformOperator(op),
            right
        );
    }

    private isNullNode(node: OperationNode) {
        return ValueNode.is(node) && node.value === null;
    }

    private transformCollectionPredicate(
        expr: BinaryExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        invariant(
            expr.op === '?' || expr.op === '!' || expr.op === '^',
            'expected "?" or "!" or "^" operator'
        );

        const left = this.transform(expr.left, context);

        invariant(
            Expression.isFieldExpr(expr.left) ||
                Expression.isMemberExpr(expr.left),
            'left operand must be field or member access'
        );

        let newContextModel: string;
        if (Expression.isFieldExpr(expr.left)) {
            const fieldDef = requireField(
                this.schema,
                context.model,
                expr.left.field
            );
            newContextModel = fieldDef.type;
        } else {
            invariant(Expression.isFieldExpr(expr.left.receiver));
            const fieldDef = requireField(
                this.schema,
                context.model,
                expr.left.receiver.field
            );
            newContextModel = fieldDef.type;
            for (const member of expr.left.members) {
                const memberDef = requireField(
                    this.schema,
                    newContextModel,
                    member
                );
                newContextModel = memberDef.type;
            }
        }

        let filter = this.transform(expr.right, {
            ...context,
            model: newContextModel as GetModels<Schema>,
            thisEntity: undefined,
        });

        if (expr.op === '!') {
            filter = logicalNot(filter);
        }

        invariant(
            SelectQueryNode.is(left),
            'expected left operand to be select query'
        );

        const count = FunctionNode.create('count', [ValueNode.create(1)]);
        const finalSelectQuery = this.updateInnerMostSelectQuery(
            left,
            filter,
            match(expr.op)
                .with('?', () =>
                    BinaryOperationNode.create(
                        count,
                        OperatorNode.create('>'),
                        ValueNode.create(0)
                    )
                )
                .with('!', () =>
                    BinaryOperationNode.create(
                        count,
                        OperatorNode.create('='),
                        ValueNode.create(0)
                    )
                )
                .with('^', () =>
                    BinaryOperationNode.create(
                        count,
                        OperatorNode.create('='),
                        ValueNode.create(0)
                    )
                )
                .exhaustive()
        );

        return finalSelectQuery;
    }

    private updateInnerMostSelectQuery(
        node: SelectQueryNode,
        where: OperationNode,
        selection: OperationNode
    ): SelectQueryNode {
        if (!node.selections || node.selections.length === 0) {
            return {
                ...node,
                selections: [
                    SelectionNode.create(
                        AliasNode.create(selection, IdentifierNode.create('$t'))
                    ),
                ],
                where: WhereNode.create(
                    node.where
                        ? conjunction(this.dialect, [node.where.where, where])
                        : where
                ),
            };
        } else {
            invariant(
                node.selections.length === 1,
                'expected exactly one selection'
            );
            const currSelection = node.selections[0]!;
            invariant(
                AliasNode.is(currSelection.selection),
                'expected alias node'
            );
            const alias = currSelection.selection.alias;
            const inner = currSelection.selection.node;
            invariant(SelectQueryNode.is(inner), 'expected select query node');
            const newInner = this.updateInnerMostSelectQuery(
                inner,
                where,
                selection
            );
            return {
                ...node,
                selections: [
                    SelectionNode.create(AliasNode.create(newInner, alias)),
                ],
            };
        }
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

        if (Expression.isNull(other)) {
            return this.transformValue(
                expr.op === '==' ? !this.auth : !!this.auth,
                'Boolean'
            );
        } else {
            throw new Error('Unsupported expression');
        }
    }

    private transformValue(value: unknown, type: BuiltinType): OperationNode {
        return ValueNode.create(
            this.dialect.transformPrimitive(value, type) ?? null
        );
    }

    @expr('unary')
    // @ts-ignore
    private _unary(
        expr: UnaryExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        // only '!' operator for now
        invariant(expr.op === '!', 'only "!" operator is supported');
        return BinaryOperationNode.create(
            this.transform(expr.operand, context),
            this.transformOperator('!='),
            trueNode(this.dialect)
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
    private _call(expr: CallExpression) {
        throw new QueryError(`Unknown function: ${expr.function}`);
    }

    private isAuthCall(value: unknown): value is CallExpression {
        return Expression.isCall(value) && value.function === 'auth';
    }

    @expr('member')
    // @ts-ignore
    private _member(
        expr: MemberExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        // auth() member access
        if (this.isAuthCall(expr.receiver)) {
            return this.valueMemberAccess(this.auth, expr, this.authType);
        }

        invariant(
            Expression.isFieldExpr(expr.receiver),
            'expect receiver to be field expression'
        );

        const receiver = this.transform(expr.receiver, context);
        invariant(
            SelectQueryNode.is(receiver),
            'expected receiver to be select query'
        );

        // relation member access
        const receiverField = requireField(
            this.schema,
            context.model,
            expr.receiver.field
        );

        // traverse forward to collect member types
        const memberFields: { fromModel: string; fieldDef: FieldDef }[] = [];
        let currType = receiverField.type;
        for (const member of expr.members) {
            const fieldDef = requireField(this.schema, currType, member);
            memberFields.push({ fieldDef, fromModel: currType });
            currType = fieldDef.type;
        }

        let currNode: SelectQueryNode | ColumnNode | undefined = undefined;
        const innerContext = { ...context, thisEntity: undefined };

        for (let i = expr.members.length - 1; i >= 0; i--) {
            const member = expr.members[i]!;
            const { fieldDef, fromModel } = memberFields[i]!;
            if (fieldDef.relation) {
                const relation = this._relation(
                    fromModel,
                    member,
                    fieldDef.type,
                    innerContext
                );
                if (currNode) {
                    invariant(
                        SelectQueryNode.is(currNode),
                        'expected select query node'
                    );
                    currNode = {
                        ...(currNode as SelectQueryNode),
                        selections: [
                            SelectionNode.create(
                                AliasNode.create(
                                    relation,
                                    IdentifierNode.create(member)
                                )
                            ),
                        ],
                    };
                } else {
                    currNode = relation;
                }
            } else {
                invariant(
                    i === expr.members.length - 1,
                    'plain field access must be the last segment'
                );
                if (currNode) {
                    invariant(
                        SelectQueryNode.is(currNode),
                        'expected select query node'
                    );
                    currNode = {
                        ...(currNode as SelectQueryNode),
                        selections: [
                            SelectionNode.create(ColumnNode.create(member)),
                        ],
                    };
                } else {
                    currNode = ColumnNode.create(member);
                }
            }
        }

        return {
            ...receiver,
            selections: [
                SelectionNode.create(
                    AliasNode.create(currNode!, IdentifierNode.create('$t'))
                ),
            ],
        };
    }

    private valueMemberAccess(
        receiver: any,
        expr: MemberExpression,
        receiverType: string
    ) {
        if (!receiver) {
            return ValueNode.create(null);
        }

        if (expr.members.length !== 1) {
            throw new Error(`Only single member access is supported`);
        }

        const field = expr.members[0]!;
        const fieldDef = requireField(this.schema, receiverType, field);
        const fieldValue = receiver[field] ?? null;
        return this.transformValue(fieldValue, fieldDef.type as BuiltinType);
    }

    // @expr('relation')
    // @ts-ignore
    private _relation(
        fromModel: string,
        field: string,
        relationModel: string,
        context: ExpressionTransformerContext<Schema>
    ): SelectQueryNode {
        const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
            this.schema,
            fromModel,
            field
        );

        if (context.thisEntity) {
            let condition: OperationNode;
            if (ownedByModel) {
                condition = conjunction(
                    this.dialect,
                    keyPairs.map(({ fk, pk }) =>
                        BinaryOperationNode.create(
                            ReferenceNode.create(
                                ColumnNode.create(pk),
                                TableNode.create(relationModel)
                            ),
                            OperatorNode.create('='),
                            context.thisEntity![fk]!
                        )
                    )
                );
            } else {
                condition = conjunction(
                    this.dialect,
                    keyPairs.map(({ fk, pk }) =>
                        BinaryOperationNode.create(
                            ReferenceNode.create(
                                ColumnNode.create(fk),
                                TableNode.create(relationModel)
                            ),
                            OperatorNode.create('='),
                            context.thisEntity![pk]!
                        )
                    )
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
                            ReferenceNode.create(
                                ColumnNode.create(fk),
                                TableNode.create(fromModel)
                            ),
                            OperatorNode.create('='),
                            ReferenceNode.create(
                                ColumnNode.create(pk),
                                TableNode.create(relationModel)
                            )
                        )
                    )
                );
            } else {
                // `relationModel` owns the fk
                condition = conjunction(
                    this.dialect,
                    keyPairs.map(({ fk, pk }) =>
                        BinaryOperationNode.create(
                            ReferenceNode.create(
                                ColumnNode.create(pk),
                                TableNode.create(fromModel)
                            ),
                            OperatorNode.create('='),
                            ReferenceNode.create(
                                ColumnNode.create(fk),
                                TableNode.create(relationModel)
                            )
                        )
                    )
                );
            }

            return {
                kind: 'SelectQueryNode',
                from: FromNode.create([TableNode.create(relationModel)]),
                where: WhereNode.create(condition),
            };
        }
    }
}
