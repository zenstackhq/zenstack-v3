import { describe, expect, it } from 'vitest';
import { safeJSONStringify } from '../src/safe-json-stringify';

describe('safeJSONStringify tests', () => {
    it('should stringify simple objects', () => {
        expect(safeJSONStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    });

    it('should stringify arrays', () => {
        expect(safeJSONStringify([1, 2, 3])).toBe('[1,2,3]');
    });

    it('should stringify strings', () => {
        expect(safeJSONStringify('hello')).toBe('"hello"');
    });

    it('should stringify numbers', () => {
        expect(safeJSONStringify(42)).toBe('42');
    });

    it('should stringify booleans', () => {
        expect(safeJSONStringify(true)).toBe('true');
        expect(safeJSONStringify(false)).toBe('false');
    });

    it('should stringify null', () => {
        expect(safeJSONStringify(null)).toBe('null');
    });

    it('should stringify bigint values as strings', () => {
        expect(safeJSONStringify(BigInt(123))).toBe('"123"');
        expect(safeJSONStringify(BigInt('9007199254740991'))).toBe('"9007199254740991"');
    });

    it('should stringify objects containing bigint values', () => {
        const obj = { id: BigInt(123), name: 'test' };
        expect(safeJSONStringify(obj)).toBe('{"id":"123","name":"test"}');
    });

    it('should stringify nested objects with bigint', () => {
        const obj = { user: { id: BigInt(456), data: { count: BigInt(789) } } };
        expect(safeJSONStringify(obj)).toBe('{"user":{"id":"456","data":{"count":"789"}}}');
    });

    it('should stringify arrays with bigint values', () => {
        const arr = [BigInt(1), BigInt(2), BigInt(3)];
        expect(safeJSONStringify(arr)).toBe('["1","2","3"]');
    });

    it('should handle mixed types including bigint', () => {
        const mixed = {
            str: 'hello',
            num: 42,
            bool: true,
            bigInt: BigInt(999),
            arr: [1, BigInt(2), 'three'],
            obj: { nested: BigInt(100) },
        };
        expect(safeJSONStringify(mixed)).toBe(
            '{"str":"hello","num":42,"bool":true,"bigInt":"999","arr":[1,"2","three"],"obj":{"nested":"100"}}',
        );
    });

    it('should handle very large bigint values', () => {
        const largeBigInt = BigInt('123456789012345678901234567890');
        expect(safeJSONStringify(largeBigInt)).toBe('"123456789012345678901234567890"');
    });

    it('should handle zero bigint', () => {
        expect(safeJSONStringify(BigInt(0))).toBe('"0"');
    });

    it('should handle negative bigint', () => {
        expect(safeJSONStringify(BigInt(-123))).toBe('"-123"');
    });

    it('should handle empty objects and arrays', () => {
        expect(safeJSONStringify({})).toBe('{}');
        expect(safeJSONStringify([])).toBe('[]');
    });
});
