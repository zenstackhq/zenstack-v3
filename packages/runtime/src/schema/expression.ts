export type Expression =
    | LiteralExpression
    | FieldReferenceExpression
    | MemberAccessExpression
    | CallExpression
    | UnaryExpression
    | BinaryExpression
    | ThisExpression
    | NullExpression;

export type LiteralExpression = {
    kind: 'literal';
    value: string | number | boolean;
};

export type FieldReferenceExpression = {
    kind: 'ref';
    model: string;
    field: string;
};

export type MemberAccessExpression = {
    kind: 'member';
    object: Expression;
    property: string;
};

export type UnaryExpression = {
    kind: 'unary';
    op: UnaryOperator;
    operand: Expression;
};

export type BinaryExpression = {
    kind: 'binary';
    op: BinaryOperator;
    left: Expression;
    right: Expression;
};

export type CallExpression = {
    kind: 'call';
    function: string;
    args?: Expression[];
};

export type ThisExpression = {
    kind: 'this';
};

export type NullExpression = {
    kind: 'null';
};

export type UnaryOperator = '!';
export type BinaryOperator =
    | '&&'
    | '||'
    | '=='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>=';

export const Expression = {
    literal: (value: string | number | boolean): LiteralExpression => {
        return {
            kind: 'literal',
            value,
        };
    },

    call: (functionName: string, args?: Expression[]): CallExpression => {
        return {
            kind: 'call',
            function: functionName,
            args,
        };
    },

    binary: (
        left: Expression,
        op: BinaryOperator,
        right: Expression
    ): BinaryExpression => {
        return {
            kind: 'binary',
            op,
            left,
            right,
        };
    },

    unary: (op: UnaryOperator, operand: Expression): UnaryExpression => {
        return {
            kind: 'unary',
            op,
            operand,
        };
    },

    _this: (): ThisExpression => {
        return {
            kind: 'this',
        };
    },

    _null: (): NullExpression => {
        return {
            kind: 'null',
        };
    },

    ref: (model: string, field: string): FieldReferenceExpression => {
        return {
            kind: 'ref',
            model,
            field,
        };
    },

    and: (expr: Expression, ...expressions: Expression[]) => {
        return expressions.reduce(
            (acc, exp) => Expression.binary(acc, '&&', exp),
            expr
        );
    },

    or: (expr: Expression, ...expressions: Expression[]) => {
        return expressions.reduce(
            (acc, exp) => Expression.binary(acc, '||', exp),
            expr
        );
    },

    is: (value: unknown, kind: Expression['kind']): value is Expression => {
        return (
            !!value &&
            typeof value === 'object' &&
            'kind' in value &&
            value.kind === kind
        );
    },

    isLiteral: (value: unknown): value is LiteralExpression =>
        Expression.is(value, 'literal'),

    isRef: (value: unknown): value is FieldReferenceExpression =>
        Expression.is(value, 'ref'),

    isCall: (value: unknown): value is CallExpression =>
        Expression.is(value, 'call'),

    isAuthCall: (value: unknown): value is CallExpression =>
        Expression.isCall(value) && value.function === 'auth',

    isNull: (value: unknown): value is NullExpression =>
        Expression.is(value, 'null'),

    isThis: (value: unknown): value is ThisExpression =>
        Expression.is(value, 'this'),
};
