import { Match } from 'effect';
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
import type { SchemaDef } from '../../../schema';
import {
    Expression,
    type BinaryExpression,
    type BinaryOperator,
    type FieldReferenceExpression,
    type LiteralExpression,
    type UnaryExpression,
} from '../../../schema/expression';
import type { BuiltinType } from '../../../schema/schema';
import type { QueryDialect } from '../../operations/dialect';
import {
    getIdFields,
    getRelationForeignKeyFieldPairs,
    requireField,
} from '../../query-utils';
import type { PolicyFeatureSettings } from '../../types';

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

export class ExpressionTransformer {
    constructor(
        private readonly schema: SchemaDef,
        private readonly queryDialect: QueryDialect,
        private readonly policySettings: PolicyFeatureSettings
    ) {}

    transform(expression: Expression): OperationNode {
        const handler = expressionHandlers.get(expression.kind);
        if (!handler) {
            throw new Error(`Unsupported expression kind: ${expression.kind}`);
        }

        return handler.value.call(this, expression);
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
    private _binary(expr: BinaryExpression) {
        if (
            Expression.isAuthCall(expr.left) ||
            Expression.isAuthCall(expr.right)
        ) {
            return this.transformAuthBinary(expr);
        }

        return BinaryOperationNode.create(
            this.transform(expr.left),
            this.transformOperator(expr.op),
            this.transform(expr.right)
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
    private _unary(expr: UnaryExpression) {
        return BinaryOperationNode.create(
            this.transform(expr.operand),
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

    // @expr('call')
    // private _call(expr: CallExpression) {
    //     return Match.value(expr.function).pipe(
    //         Match.when('auth', () => this.policySettings.auth)
    //     );
    // }
}
