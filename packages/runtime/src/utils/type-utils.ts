import type Decimal from 'decimal.js';

export type NullableIf<T, Condition extends boolean> = Condition extends true
    ? T | null
    : T;

export type PartialRecord<K extends string | number | symbol, T> = Partial<
    Record<K, T>
>;

export type WrapType<T, Optional = false, Array = false> = Optional extends true
    ? T | null
    : Array extends true
    ? T[]
    : T;

export type MapBaseType<T> = T extends 'String'
    ? string
    : T extends 'Boolean'
    ? boolean
    : T extends 'Int' | 'Float'
    ? number
    : T extends 'BigInt'
    ? bigint
    : T extends 'Decimal'
    ? Decimal
    : T extends 'DateTime'
    ? Date
    : T extends 'Json'
    ? JsonValue
    : unknown;

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonObject
    | JsonArray;

export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = Array<JsonValue>;

// eslint-disable-next-line @typescript-eslint/ban-types
export type Simplify<T> = { [Key in keyof T]: T[Key] } & {};

export function call(code: string) {
    return { code };
}

export type OrArray<T, IF extends boolean = true> = IF extends true
    ? T | T[]
    : T;

export type NonEmptyArray<T> = [T, ...T[]];

export type ValueOfPotentialTuple<T> = T extends unknown[] ? T[number] : T;

// cause typescript not to expand types and preserve names
type NoExpand<T> = T extends unknown ? T : never;

// this type assumes the passed object is entirely optional
export type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
        ?
              | (K extends keyof O ? { [P in K]: O[P] } & O : O)
              | ({ [P in keyof O as P extends K ? K : never]-?: O[P] } & O)
        : never
>;

type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

export type XOR<T, U> = T extends object
    ? U extends object
        ? (Without<T, U> & U) | (Without<U, T> & T)
        : U
    : T;

export type MergeIf<T, U, Condition extends boolean> = Condition extends true
    ? T & U
    : T;

export type MaybePromise<T> = T | Promise<T>;

export type PrependParameter<Param, Func> = Func extends (
    ...args: any[]
) => infer R
    ? (p: Param, ...args: Parameters<Func>) => R
    : never;

export type OrUndefinedIf<T, Condition extends boolean> = Condition extends true
    ? T | undefined
    : T;
