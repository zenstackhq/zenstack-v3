import { describe, expect, it } from 'vitest';
import { clone } from '../src/clone';

describe('clone tests', () => {
    describe('primitives', () => {
        it('should return primitives as-is', () => {
            expect(clone(42)).toBe(42);
            expect(clone('hello')).toBe('hello');
            expect(clone(true)).toBe(true);
            expect(clone(false)).toBe(false);
            expect(clone(null)).toBe(null);
            expect(clone(undefined)).toBe(undefined);
        });
    });

    describe('arrays', () => {
        it('should clone simple arrays', () => {
            const arr = [1, 2, 3];
            const cloned = clone(arr);
            expect(cloned).toEqual(arr);
            expect(cloned).not.toBe(arr);
        });

        it('should deep clone nested arrays', () => {
            const arr = [1, [2, 3], [4, [5, 6]]];
            const cloned = clone(arr);
            expect(cloned).toEqual(arr);
            expect(cloned).not.toBe(arr);
            expect(cloned[1]).not.toBe(arr[1]);
            expect(cloned[2]).not.toBe(arr[2]);
        });

        it('should clone arrays with objects', () => {
            const arr = [{ a: 1 }, { b: 2 }];
            const cloned = clone(arr);
            expect(cloned).toEqual(arr);
            expect(cloned).not.toBe(arr);
            expect(cloned[0]).not.toBe(arr[0]);
            expect(cloned[1]).not.toBe(arr[1]);
        });

        it('should handle empty arrays', () => {
            const arr: number[] = [];
            const cloned = clone(arr);
            expect(cloned).toEqual([]);
            expect(cloned).not.toBe(arr);
        });
    });

    describe('plain objects', () => {
        it('should clone simple objects', () => {
            const obj = { a: 1, b: 2 };
            const cloned = clone(obj);
            expect(cloned).toEqual(obj);
            expect(cloned).not.toBe(obj);
        });

        it('should deep clone nested objects', () => {
            const obj = { a: 1, b: { c: 2, d: { e: 3 } } };
            const cloned = clone(obj);
            expect(cloned).toEqual(obj);
            expect(cloned).not.toBe(obj);
            expect(cloned.b).not.toBe(obj.b);
            expect(cloned.b.d).not.toBe(obj.b.d);
        });

        it('should clone objects with arrays', () => {
            const obj = { a: [1, 2], b: { c: [3, 4] } };
            const cloned = clone(obj);
            expect(cloned).toEqual(obj);
            expect(cloned).not.toBe(obj);
            expect(cloned.a).not.toBe(obj.a);
            expect(cloned.b.c).not.toBe(obj.b.c);
        });

        it('should handle empty objects', () => {
            const obj = {};
            const cloned = clone(obj);
            expect(cloned).toEqual({});
            expect(cloned).not.toBe(obj);
        });

        it('should handle objects with null prototype', () => {
            const obj = Object.create(null);
            obj.foo = 'bar';
            const cloned = clone(obj);
            expect(cloned).toEqual(obj);
            expect(cloned).not.toBe(obj);
        });
    });

    describe('non-plain objects', () => {
        it('should return Date objects as-is', () => {
            const date = new Date();
            const cloned = clone(date);
            expect(cloned).toBe(date);
        });

        it('should return RegExp objects as-is', () => {
            const regex = /test/gi;
            const cloned = clone(regex);
            expect(cloned).toBe(regex);
        });

        it('should return class instances as-is', () => {
            class MyClass {
                value = 42;
            }
            const instance = new MyClass();
            const cloned = clone(instance);
            expect(cloned).toBe(instance);
        });

        it('should return functions as-is', () => {
            const fn = () => 42;
            const cloned = clone(fn);
            expect(cloned).toBe(fn);
        });
    });

    describe('mixed structures', () => {
        it('should handle complex mixed structures', () => {
            const complex = {
                number: 42,
                string: 'hello',
                bool: true,
                null: null,
                array: [1, 2, { nested: 'value' }],
                object: {
                    a: [1, 2, 3],
                    b: { c: 4 },
                },
            };
            const cloned = clone(complex);
            expect(cloned).toEqual(complex);
            expect(cloned).not.toBe(complex);
            expect(cloned.array).not.toBe(complex.array);
            expect(cloned.array[2]).not.toBe(complex.array[2]);
            expect(cloned.object).not.toBe(complex.object);
            expect(cloned.object.a).not.toBe(complex.object.a);
        });

        it('should preserve primitive values in nested structures', () => {
            const obj = { a: { b: { c: 42 } } };
            const cloned = clone(obj);
            expect(cloned.a.b.c).toBe(42);
        });
    });
});
