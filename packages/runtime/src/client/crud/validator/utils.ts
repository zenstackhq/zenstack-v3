import { invariant } from '@zenstackhq/common-helpers';
import type {
    AttributeApplication,
    BinaryExpression,
    CallExpression,
    Expression,
    FieldExpression,
    MemberExpression,
    UnaryExpression,
} from '@zenstackhq/sdk/schema';
import { match, P } from 'ts-pattern';
import { z } from 'zod';
import { ExpressionUtils } from '../../../schema';
import { QueryError } from '../../errors';

function getArgValue<T extends string | number | boolean>(expr: Expression | undefined): T | undefined {
    if (!expr || !ExpressionUtils.isLiteral(expr)) {
        return undefined;
    }
    return expr.value as T;
}

export function addStringValidation(schema: z.ZodString, attributes: AttributeApplication[] | undefined): z.ZodSchema {
    if (!attributes || attributes.length === 0) {
        return schema;
    }

    for (const attr of attributes) {
        match(attr.name)
            .with('@length', () => {
                const min = getArgValue<number>(attr.args?.[0]?.value);
                if (min !== undefined) {
                    schema = schema.min(min);
                }
                const max = getArgValue<number>(attr.args?.[1]?.value);
                if (max !== undefined) {
                    schema = schema.max(max);
                }
            })
            .with('@startsWith', () => {
                const value = getArgValue<string>(attr.args?.[0]?.value);
                if (value !== undefined) {
                    schema = schema.startsWith(value);
                }
            })
            .with('@endsWith', () => {
                const value = getArgValue<string>(attr.args?.[0]?.value);
                if (value !== undefined) {
                    schema = schema.endsWith(value);
                }
            })
            .with('@contains', () => {
                const value = getArgValue<string>(attr.args?.[0]?.value);
                if (value !== undefined) {
                    schema = schema.includes(value);
                }
            })
            .with('@regex', () => {
                const pattern = getArgValue<string>(attr.args?.[0]?.value);
                if (pattern !== undefined) {
                    schema = schema.regex(new RegExp(pattern));
                }
            })
            .with('@email', () => {
                schema = schema.email();
            })
            .with('@datetime', () => {
                schema = schema.datetime();
            })
            .with('@url', () => {
                schema = schema.url();
            })
            .with('@trim', () => {
                schema = schema.trim();
            })
            .with('@lower', () => {
                schema = schema.toLowerCase();
            })
            .with('@upper', () => {
                schema = schema.toUpperCase();
            });
    }
    return schema;
}

export function addNumberValidation(schema: z.ZodNumber, attributes: AttributeApplication[] | undefined): z.ZodSchema {
    if (!attributes || attributes.length === 0) {
        return schema;
    }

    for (const attr of attributes) {
        const val = getArgValue<number>(attr.args?.[0]?.value);
        if (val === undefined) {
            continue;
        }
        match(attr.name)
            .with('@gt', () => {
                schema = schema.gt(val);
            })
            .with('@gte', () => {
                schema = schema.gte(val);
            })
            .with('@lt', () => {
                schema = schema.lt(val);
            })
            .with('@lte', () => {
                schema = schema.lte(val);
            })
            .with('@lt', () => {
                schema = schema.lt(val);
            })
            .with('@lte', () => {
                schema = schema.lte(val);
            });
    }
    return schema;
}

export function addCustomValidation(schema: z.ZodSchema, attributes: AttributeApplication[] | undefined): z.ZodSchema {
    const attrs = attributes?.filter((a) => a.name === '@@validate');
    if (!attrs || attrs.length === 0) {
        return schema;
    }

    for (const attr of attrs) {
        const expr = attr.args?.[0]?.value;
        if (!expr) {
            continue;
        }
        const message = getArgValue<string>(attr.args?.[1]?.value);
        const pathExpr = attr.args?.[2]?.value;
        let path: string[] | undefined = undefined;
        if (pathExpr && ExpressionUtils.isArray(pathExpr)) {
            path = pathExpr.items.map((e) => ExpressionUtils.getLiteralValue(e) as string);
        }
        schema = applyValidation(schema, expr, message, path);
    }
    return schema;
}

function applyValidation(
    schema: z.ZodSchema,
    expr: Expression,
    message: string | undefined,
    path: string[] | undefined,
) {
    const options: z.CustomErrorParams = {};
    if (message) {
        options.message = message;
    }
    if (path) {
        options.path = path;
    }
    return schema.refine((data) => Boolean(evalExpression(data, expr)), options);
}

function evalExpression(data: any, expr: Expression): unknown {
    return match(expr)
        .with({ kind: 'literal' }, (e) => e.value)
        .with({ kind: 'array' }, (e) => e.items.map((item) => evalExpression(data, item)))
        .with({ kind: 'field' }, (e) => evalField(data, e))
        .with({ kind: 'member' }, (e) => evalMember(data, e))
        .with({ kind: 'unary' }, (e) => evalUnary(data, e))
        .with({ kind: 'binary' }, (e) => evalBinary(data, e))
        .with({ kind: 'call' }, (e) => evalCall(data, e))
        .with({ kind: 'this' }, () => data ?? null)
        .with({ kind: 'null' }, () => null)
        .exhaustive();
}

function evalField(data: any, e: FieldExpression) {
    return data?.[e.field] ?? null;
}

function evalUnary(data: any, expr: UnaryExpression) {
    const operand = evalExpression(data, expr.operand);
    switch (expr.op) {
        case '!':
            return !operand;
        default:
            throw new Error(`Unsupported unary operator: ${expr.op}`);
    }
}

function evalBinary(data: any, expr: BinaryExpression) {
    const left = evalExpression(data, expr.left);
    const right = evalExpression(data, expr.right);
    return match(expr.op)
        .with('&&', () => Boolean(left) && Boolean(right))
        .with('||', () => Boolean(left) || Boolean(right))
        .with('==', () => left == right) // eslint-disable-line eqeqeq
        .with('!=', () => left != right) // eslint-disable-line eqeqeq
        .with('<', () => (left as any) < (right as any))
        .with('<=', () => (left as any) <= (right as any))
        .with('>', () => (left as any) > (right as any))
        .with('>=', () => (left as any) >= (right as any))
        .with('?', () => {
            if (!Array.isArray(left)) {
                return false;
            }
            return left.some((item) => item === right);
        })
        .with('!', () => {
            if (!Array.isArray(left)) {
                return false;
            }
            return left.every((item) => item === right);
        })
        .with('^', () => {
            if (!Array.isArray(left)) {
                return false;
            }
            return !left.some((item) => item === right);
        })
        .with('in', () => {
            if (!Array.isArray(right)) {
                return false;
            }
            return right.includes(left);
        })
        .exhaustive();
}

function evalMember(data: any, expr: MemberExpression) {
    let result: any = evalExpression(data, expr.receiver);
    for (const member of expr.members) {
        if (!result || typeof result !== 'object') {
            return undefined;
        }
        result = result[member];
    }
    return result ?? null;
}

function evalCall(data: any, expr: CallExpression) {
    const fieldArg = expr.args?.[0] ? evalExpression(data, expr.args[0]) : undefined;
    return (
        match(expr.function)
            // string functions
            .with('length', (f) => {
                if (fieldArg === undefined || fieldArg === null) {
                    return false;
                }
                invariant(typeof fieldArg === 'string', `"${f}" first argument must be a string`);

                const min = getArgValue<number>(expr.args?.[1]);
                const max = getArgValue<number>(expr.args?.[2]);
                if (min && fieldArg.length < min) {
                    return false;
                }
                if (max && fieldArg.length > max) {
                    return false;
                }
                return true;
            })
            .with(P.union('startsWith', 'endsWith', 'contains'), (f) => {
                if (fieldArg === undefined || fieldArg === null) {
                    return false;
                }
                invariant(typeof fieldArg === 'string', `"${f}" first argument must be a string`);
                invariant(expr.args?.[1], `"${f}" requires a search argument`);

                const search = getArgValue<string>(expr.args?.[1])!;
                const caseInsensitive = getArgValue<boolean>(expr.args?.[2]) ?? false;

                const matcher = (x: string, y: string) =>
                    match(f)
                        .with('startsWith', () => x.startsWith(y))
                        .with('endsWith', () => x.endsWith(y))
                        .with('contains', () => x.includes(y))
                        .exhaustive();
                return caseInsensitive
                    ? matcher(fieldArg.toLowerCase(), search.toLowerCase())
                    : matcher(fieldArg, search);
            })
            .with('regex', (f) => {
                if (fieldArg === undefined || fieldArg === null) {
                    return false;
                }
                invariant(typeof fieldArg === 'string', `"${f}" first argument must be a string`);
                const pattern = getArgValue<string>(expr.args?.[1])!;
                invariant(pattern !== undefined, `"${f}" requires a pattern argument`);
                return new RegExp(pattern).test(fieldArg);
            })
            .with(P.union('email', 'url', 'datetime'), (f) => {
                if (fieldArg === undefined || fieldArg === null) {
                    return false;
                }
                return z.string()[f]().safeParse(fieldArg).success;
            })
            // list functions
            .with(P.union('has', 'hasEvery', 'hasSome'), (f) => {
                invariant(expr.args?.[1], `${f} requires a search argument`);
                if (fieldArg === undefined || fieldArg === null) {
                    return false;
                }
                invariant(Array.isArray(fieldArg), `"${f}" first argument must be an array field`);

                const search = evalExpression(data, expr.args?.[1])!;
                const matcher = (x: any[], y: any) =>
                    match(f)
                        .with('has', () => x.some((item) => item === y))
                        .with('hasEvery', () => {
                            invariant(Array.isArray(y), 'hasEvery second argument must be an array');
                            return y.every((v) => x.some((item) => item === v));
                        })
                        .with('hasSome', () => {
                            invariant(Array.isArray(y), 'hasSome second argument must be an array');
                            return y.some((v) => x.some((item) => item === v));
                        })
                        .exhaustive();
                return matcher(fieldArg, search);
            })
            .with('isEmpty', (f) => {
                if (fieldArg === undefined || fieldArg === null) {
                    return false;
                }
                invariant(Array.isArray(fieldArg), `"${f}" first argument must be an array field`);
                return fieldArg.length === 0;
            })
            .otherwise(() => {
                throw new QueryError(`Unknown function "${expr.function}"`);
            })
    );
}
