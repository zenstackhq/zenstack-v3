export class DbNullClass {
    __brand = 'DbNull' as const;
}
export const DbNull = new DbNullClass();
export type DbNull = typeof DbNull;

export class JsonNullClass {
    __brand = 'JsonNull' as const;
}
export const JsonNull = new JsonNullClass();
export type JsonNull = typeof JsonNull;

export class AnyNullClass {
    __brand = 'AnyNull' as const;
}
export const AnyNull = new AnyNullClass();
export type AnyNull = typeof AnyNull;
