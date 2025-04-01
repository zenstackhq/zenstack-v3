import {
    AndNode,
    BinaryOperationNode,
    ColumnNode,
    OperatorNode,
    OrNode,
    ReferenceNode,
    ValueNode,
    type OperationNode,
} from 'kysely';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { Client } from '../../client';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base';
import { QueryError } from '../../client/errors';
import {
    getIdFields,
    getRelationForeignKeyFieldPairs,
    requireField,
} from '../../client/query-utils';
import type { CallExpression, SchemaDef } from '../../schema';
import {
    Expression,
    type BinaryExpression,
    type BinaryOperator,
    type FieldReferenceExpression,
    type LiteralExpression,
    type UnaryExpression,
} from '../../schema/expression';
import type { BuiltinType, GetModels } from '../../schema/schema';
import type { PolicyOptions } from './options';
import type { SchemaPolicy } from './types';

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
    private readonly options: PolicyOptions<Schema>;
    private readonly dialect: BaseCrudDialect<Schema>;
    private readonly schemaPolicy: SchemaPolicy;

    constructor(
        private readonly client: Client<Schema>,
        options: PolicyOptions<Schema>
    ) {
        // if (!options.features?.policy) {
        //     throw new QueryError(`Policy feature setting is required`);
        // }
        // this.policySettings = options.features.policy;
        this.options = options;
        this.dialect = getCrudDialect(client.$schema, client.$options);
        invariant(this.client.$schema.plugins['policy']);
        this.schemaPolicy = this.client.$schema.plugins[
            'policy'
        ] as SchemaPolicy;
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
        if (this.isAuthCall(expr.left) || this.isAuthCall(expr.right)) {
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
        if (this.isAuthCall(expr.left)) {
            other = expr.right;
        } else {
            other = expr.left;
        }

        if (Expression.isNull(other)) {
            return this.transformValue(
                expr.op === '==' ? !this.options.auth : !!this.options.auth,
                'Boolean'
            );
        } else if (Expression.isThis(other)) {
            const idFields = getIdFields(
                this.client.$schema,
                this.schemaPolicy.authModel
            );
            return this.buildAuthFieldComparison(
                idFields.map((f) => ({ authField: f, tableField: f })),
                expr.op
            );
        } else if (Expression.isRef(other)) {
            const { keyPairs, ownedByModel } = getRelationForeignKeyFieldPairs(
                this.client.$schema,
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
            this.options.auth?.[field as keyof typeof this.options.auth],
            requireField(
                this.client.$schema,
                this.schemaPolicy.authModel!,
                field
            ).type as BuiltinType
        );
    }

    private transformValue(value: unknown, type: BuiltinType): OperationNode {
        return ValueNode.create(
            this.dialect.transformPrimitive(value, type) ?? null
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
        const mappedOp = match(op)
            .with('==', () => '=' as const)
            .otherwise(() => op);
        return OperatorNode.create(mappedOp);
    }

    @expr('call')
    private _call(
        expr: CallExpression,
        context: ExpressionTransformerContext<Schema>
    ) {
        throw new QueryError(`Unknown function: ${expr.function}`);
    }

    private isAuthCall(value: unknown): value is CallExpression {
        return Expression.isCall(value) && value.function === 'auth';
    }
}
