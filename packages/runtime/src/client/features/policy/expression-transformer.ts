import { Match } from 'effect';
import type { OperandExpression, SqlBool } from 'kysely';
import {
    AndNode,
    BinaryOperationNode,
    ColumnNode,
    expressionBuilder,
    OperatorNode,
    OrNode,
    ReferenceNode,
    ValueNode,
    type OperationNode,
} from 'kysely';
import type { CallExpression, SchemaDef } from '../../../schema';
import {
    Expression,
    type BinaryExpression,
    type BinaryOperator,
    type FieldReferenceExpression,
    type LiteralExpression,
    type UnaryExpression,
} from '../../../schema/expression';
import type { BuiltinType, GetModels } from '../../../schema/schema';
import { QueryError } from '../../errors';
import type { QueryDialect } from '../../operations/dialect';
import type { PolicySettings } from '../../options';
import {
    getIdFields,
    getRelationForeignKeyFieldPairs,
    requireField,
} from '../../query-utils';

export type ExpressionTransformerContext<Schema extends SchemaDef> = {
    model: GetModels<Schema>;
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
    constructor(
        private readonly schema: Schema,
        private readonly queryDialect: QueryDialect,
        private readonly policySettings: PolicySettings<Schema>
    ) {}

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
    private _literal(expr: LiteralExpression) {
        return ValueNode.create(expr.value);
    }

    @expr('ref')
    private _ref(expr: FieldReferenceExpression) {
        return ReferenceNode.create(ColumnNode.create(expr.field));
    }

    @expr('null')
    private _null() {
        return ValueNode.create(null);
    }

    @expr('binary')
    private _binary(
        expr: BinaryExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        if (
            Expression.isAuthCall(expr.left) ||
            Expression.isAuthCall(expr.right)
        ) {
            return this.transformAuthBinary(expr);
        }

        return BinaryOperationNode.create(
            this.transform(expr.left, context),
            this.transformOperator(expr.op),
            this.transform(expr.right, context)
        );
    }

    private transformAuthBinary(expr: BinaryExpression) {
        if (expr.op !== '==' && expr.op !== '!=') {
            throw new Error(`Unsupported operator for auth call: ${expr.op}`);
        }
        let other: Expression;
        if (Expression.isAuthCall(expr.left)) {
            other = expr.right;
        } else {
            other = expr.left;
        }

        if (Expression.isNull(other)) {
            return this.transformValue(
                expr.op === '=='
                    ? !this.policySettings.auth
                    : !!this.policySettings.auth,
                'Boolean'
            );
        } else if (Expression.isThis(other)) {
            const idFields = getIdFields(this.schema, this.schema.authModel);
            return this.buildAuthFieldComparison(
                idFields.map((f) => ({ authField: f, tableField: f })),
                expr.op
            );
        } else if (Expression.isRef(other)) {
            const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
                this.schema,
                other.model,
                other.field
            );

            if (ownedByModel) {
                return this.buildAuthFieldComparison(
                    keyPairs.map(
                        ({ fk, pk }) => ({ authField: pk, tableField: fk }),
                        expr.op
                    ),
                    expr.op
                );
            } else {
                throw new Error('Todo: join relation');
            }
        } else {
            throw new Error('Unsupported expression');
        }
    }

    private buildAuthFieldComparison(
        fields: Array<{ authField: string; tableField: string }>,
        op: '==' | '!='
    ) {
        if (op === '==') {
            return this.buildAndNode(
                fields.map(({ authField, tableField }) =>
                    BinaryOperationNode.create(
                        ReferenceNode.create(ColumnNode.create(tableField)),
                        this.transformOperator(op),
                        this.transformAuthFieldSelect(authField)
                    )
                )
            );
        } else {
            return this.buildOrNode(
                fields.map(({ authField, tableField }) =>
                    BinaryOperationNode.create(
                        ReferenceNode.create(ColumnNode.create(tableField)),
                        this.transformOperator('!='),
                        this.transformAuthFieldSelect(authField)
                    )
                )
            );
        }
    }

    private transformAuthFieldSelect(field: string): OperationNode {
        return this.transformValue(
            this.policySettings.auth?.[field],
            requireField(this.schema, this.schema.authModel, field)
                .type as BuiltinType
        );
    }

    private transformValue(value: unknown, type: BuiltinType): OperationNode {
        return ValueNode.create(
            this.queryDialect.transformPrimitive(value, type) ?? null
        );
    }

    private buildAndNode(nodes: OperationNode[]) {
        if (nodes.length === 0) {
            throw new Error('Expected at least one node');
        }
        if (nodes.length === 1) {
            return nodes[0];
        }
        const initial = nodes.shift()!;
        return nodes.reduce(
            (prev, curr) => AndNode.create(prev, curr),
            initial
        );
    }

    private buildOrNode(nodes: OperationNode[]) {
        if (nodes.length === 0) {
            throw new Error('Expected at least one node');
        }
        if (nodes.length === 1) {
            return nodes[0];
        }
        const initial = nodes.shift()!;
        return nodes.reduce((prev, curr) => OrNode.create(prev, curr), initial);
    }

    @expr('unary')
    private _unary(
        expr: UnaryExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        return BinaryOperationNode.create(
            this.transform(expr.operand, context),
            this.transformOperator('!='),
            ValueNode.create(true)
        );
    }

    private transformOperator(op: BinaryOperator) {
        const mappedOp = Match.value(op).pipe(
            Match.when('==', () => '=' as const),
            Match.orElse(() => op)
        );
        return OperatorNode.create(mappedOp);
    }

    @expr('call')
    private _call(
        expr: CallExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        let rule: Function | undefined;
        if ('externalRules' in this.policySettings) {
            const externalRules = this.policySettings.externalRules;
            if (externalRules) {
                const modelRules =
                    externalRules[context.model as keyof typeof externalRules];
                if (modelRules) {
                    rule = modelRules[expr.function as keyof typeof modelRules];
                }
            }
        }

        if (rule && typeof rule === 'function') {
            const eb = expressionBuilder();
            const literalArgs = (expr.args ?? []).map((arg) => {
                if (Expression.isLiteral(arg)) {
                    return arg.value;
                } else {
                    throw new QueryError('Expected literal argument');
                }
            });
            const builtExpr: OperandExpression<SqlBool> = rule(eb, literalArgs);
            return builtExpr.toOperationNode();
        } else {
            throw new QueryError(`Unknown function: ${expr.function}`);
        }
    }
}
