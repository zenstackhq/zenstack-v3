export type Expression =
    | LiteralExpression
    | ArrayExpression
    | FieldExpression
    | MemberExpression
    | CallExpression
    | UnaryExpression
    | BinaryExpression
    | ThisExpression
    | NullExpression;

export type LiteralExpression = {
    kind: 'literal';
    value: string | number | boolean;
};

export type ArrayExpression = {
    kind: 'array';
    items: Expression[];
};

export type FieldExpression = {
    kind: 'field';
    field: string;
};

export type MemberExpression = {
    kind: 'member';
    receiver: Expression;
    members: string[];
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
    | '>='
    | '?'
    | '!'
    | '^';

export const Expression = {
    literal: (value: string | number | boolean): LiteralExpression => {
        return {
            kind: 'literal',
            value,
        };
    },

    array: (items: Expression[]): ArrayExpression => {
        return {
            kind: 'array',
            items,
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

    field: (field: string): FieldExpression => {
        return {
            kind: 'field',
            field,
        };
    },

    member: (receiver: Expression, members: string[]): MemberExpression => {
        return {
            kind: 'member',
            receiver: receiver,
            members,
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

    isArray: (value: unknown): value is ArrayExpression =>
        Expression.is(value, 'array'),

    isCall: (value: unknown): value is CallExpression =>
        Expression.is(value, 'call'),

    isNull: (value: unknown): value is NullExpression =>
        Expression.is(value, 'null'),

    isThis: (value: unknown): value is ThisExpression =>
        Expression.is(value, 'this'),

    isUnaryExpr: (value: unknown): value is UnaryExpression =>
        Expression.is(value, 'unary'),

    isBinaryExpr: (value: unknown): value is BinaryExpression =>
        Expression.is(value, 'binary'),

    isFieldExpr: (value: unknown): value is FieldExpression =>
        Expression.is(value, 'field'),

    isMemberExpr: (value: unknown): value is MemberExpression =>
        Expression.is(value, 'member'),

    isCallExpr: (value: unknown): value is CallExpression =>
        Expression.is(value, 'call'),

    isThisExpr: (value: unknown): value is ThisExpression =>
        Expression.is(value, 'this'),
};
