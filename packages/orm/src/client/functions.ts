import { invariant, lowerCaseFirst, upperCaseFirst } from '@zenstackhq/common-helpers';
import { sql, ValueNode, type BinaryOperator, type Expression, type ExpressionBuilder } from 'kysely';
import { match } from 'ts-pattern';
import type { ZModelFunction, ZModelFunctionContext } from './options';

// TODO: migrate default value generation functions to here too

export const contains: ZModelFunction<any> = (eb, args, context) => textMatch(eb, args, context, 'contains');

export const search: ZModelFunction<any> = (_eb: ExpressionBuilder<any, any>, _args: Expression<any>[]) => {
    throw new Error(`"search" function is not implemented yet`);
};

export const startsWith: ZModelFunction<any> = (eb, args, context) => textMatch(eb, args, context, 'startsWith');

export const endsWith: ZModelFunction<any> = (eb, args, context) => textMatch(eb, args, context, 'endsWith');

const textMatch = (
    eb: ExpressionBuilder<any, any>,
    args: Expression<any>[],
    { dialect }: ZModelFunctionContext<any>,
    method: 'contains' | 'startsWith' | 'endsWith',
) => {
    const [field, search, caseInsensitive = undefined] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }

    const casingBehavior = dialect.getStringCasingBehavior();
    const caseInsensitiveValue = readBoolean(caseInsensitive, false);
    let op: BinaryOperator;
    let fieldExpr = field;
    let searchExpr = search;

    if (caseInsensitiveValue) {
        // case-insensitive search
        if (casingBehavior.supportsILike) {
            // use ILIKE if supported
            op = 'ilike';
        } else {
            // otherwise change both sides to lower case
            op = 'like';
            if (casingBehavior.likeCaseSensitive === true) {
                fieldExpr = eb.fn('LOWER', [fieldExpr]);
                searchExpr = eb.fn('LOWER', [searchExpr]);
            }
        }
    } else {
        // case-sensitive search, just use LIKE and deliver whatever the database's behavior is
        op = 'like';
    }

    searchExpr = match(method)
        .with('contains', () => eb.fn('CONCAT', [sql.lit('%'), sql`CAST(${searchExpr} as text)`, sql.lit('%')]))
        .with('startsWith', () => eb.fn('CONCAT', [sql`CAST(${searchExpr} as text)`, sql.lit('%')]))
        .with('endsWith', () => eb.fn('CONCAT', [sql.lit('%'), sql`CAST(${searchExpr} as text)`]))
        .exhaustive();

    return eb(fieldExpr, op, searchExpr);
};

export const has: ZModelFunction<any> = (eb, args) => {
    const [field, search] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }
    return eb(field, '@>', [search]);
};

export const hasEvery: ZModelFunction<any> = (eb: ExpressionBuilder<any, any>, args: Expression<any>[]) => {
    const [field, search] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }
    return eb(field, '@>', search);
};

export const hasSome: ZModelFunction<any> = (eb, args) => {
    const [field, search] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }
    return eb(field, '&&', search);
};

export const isEmpty: ZModelFunction<any> = (eb, args, { dialect }: ZModelFunctionContext<any>) => {
    const [field] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    return eb(dialect.buildArrayLength(field), '=', sql.lit(0));
};

export const now: ZModelFunction<any> = () => sql.raw('CURRENT_TIMESTAMP');

export const currentModel: ZModelFunction<any> = (_eb, args, { model }: ZModelFunctionContext<any>) => {
    let result = model;
    const [casing] = args;
    if (casing) {
        result = processCasing(casing, result, model);
    }
    return sql.lit(result);
};

export const currentOperation: ZModelFunction<any> = (_eb, args, { operation }: ZModelFunctionContext<any>) => {
    let result: string = operation;
    const [casing] = args;
    if (casing) {
        result = processCasing(casing, result, operation);
    }
    return sql.lit(result);
};

function processCasing(casing: Expression<any>, result: string, model: string) {
    const opNode = casing.toOperationNode();
    invariant(ValueNode.is(opNode) && typeof opNode.value === 'string', '"casting" parameter must be a string value');
    result = match(opNode.value)
        .with('original', () => model)
        .with('upper', () => result.toUpperCase())
        .with('lower', () => result.toLowerCase())
        .with('capitalize', () => upperCaseFirst(result))
        .with('uncapitalize', () => lowerCaseFirst(result))
        .otherwise(() => {
            throw new Error(
                `Invalid casing value: ${opNode.value}. Must be "original", "upper", "lower", "capitalize", or "uncapitalize".`,
            );
        });
    return result;
}

function readBoolean(expr: Expression<any> | undefined, defaultValue: boolean) {
    if (expr === undefined) {
        return defaultValue;
    }
    const opNode = expr.toOperationNode();
    invariant(ValueNode.is(opNode), 'expression must be a literal value');
    return !!opNode.value;
}
