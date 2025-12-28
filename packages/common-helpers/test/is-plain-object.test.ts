import { describe, expect, it } from 'vitest';
import { isPlainObject } from '../src/is-plain-object';

describe('isPlainObject tests', () => {
    it('should return true for plain objects', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject({ a: 1 })).toBe(true);
        expect(isPlainObject({ a: 1, b: { c: 2 } })).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
    });

    it('should return false for non-plain objects', () => {
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject(undefined)).toBe(false);
        expect(isPlainObject(42)).toBe(false);
        expect(isPlainObject('string')).toBe(false);
        expect(isPlainObject(true)).toBe(false);
        expect(isPlainObject(false)).toBe(false);
    });

    it('should return false for arrays', () => {
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject([1, 2, 3])).toBe(false);
    });

    it('should return false for class instances', () => {
        class MyClass {}
        expect(isPlainObject(new MyClass())).toBe(false);
        expect(isPlainObject(new Date())).toBe(false);
        expect(isPlainObject(new Error())).toBe(false);
        expect(isPlainObject(new RegExp(''))).toBe(false);
    });

    it('should return false for functions', () => {
        expect(isPlainObject(() => {})).toBe(false);
        expect(isPlainObject(function () {})).toBe(false);
    });

    it('should return true for objects with custom prototype', () => {
        // Objects created with Object.create still have isPrototypeOf on their prototype chain
        const obj = Object.create({ custom: 'prototype' });
        expect(isPlainObject(obj)).toBe(true);
    });

    it('should handle objects without hasOwnProperty', () => {
        const obj = Object.create(null);
        obj.foo = 'bar';
        expect(isPlainObject(obj)).toBe(true);
    });
});
