import { invariant, lowerCaseFirst, upperCaseFirst } from '@zenstackhq/common-helpers';
import { sql, ValueNode, type Expression, type ExpressionBuilder } from 'kysely';
import { match } from 'ts-pattern';
import type { ZModelFunction, ZModelFunctionContext } from './options';

// TODO: migrate default value generation functions to here too

export const contains: ZModelFunction<any> = (eb, args) => {
    const [field, search, caseInsensitive = false] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }
    const searchExpr = eb.fn('CONCAT', [sql.lit('%'), sql`CAST(${search} as text)`, sql.lit('%')]);
    return eb(field, caseInsensitive ? 'ilike' : 'like', searchExpr);
};

export const search: ZModelFunction<any> = (_eb: ExpressionBuilder<any, any>, _args: Expression<any>[]) => {
    throw new Error(`"search" function is not implemented yet`);
};

export const startsWith: ZModelFunction<any> = (eb, args) => {
    const [field, search] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }
    const searchExpr = eb.fn('CONCAT', [sql`CAST(${search} as text)`, sql.lit('%')]);
    return eb(field, 'like', searchExpr);
};

export const endsWith: ZModelFunction<any> = (eb, args) => {
    const [field, search] = args;
    if (!field) {
        throw new Error('"field" parameter is required');
    }
    if (!search) {
        throw new Error('"search" parameter is required');
    }
    const searchExpr = eb.fn('CONCAT', [sql.lit('%'), sql`CAST(${search} as text)`]);
    return eb(field, 'like', searchExpr);
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
    return eb(dialect.buildArrayLength(eb, field), '=', sql.lit(0));
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
