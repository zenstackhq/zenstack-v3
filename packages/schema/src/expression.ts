export type Expression =
    | LiteralExpression
    | ArrayExpression
    | FieldExpression
    | MemberExpression
    | CallExpression
    | UnaryExpression
    | BinaryExpression
    | BindingExpression
    | ThisExpression
    | NullExpression;

export type LiteralExpression = {
    kind: 'literal';
    value: string | number | boolean;
};

export type ArrayExpression = {
    kind: 'array';
    type: string;
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

export type BindingExpression = {
    kind: 'binding';
    name: string;
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
    binding?: string;
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
export type BinaryOperator = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '?' | '!' | '^' | 'in';
