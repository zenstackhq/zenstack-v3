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
    | '^'
    | 'in';
