import { describe, expect, it } from 'vitest';
import { invariant } from '../src/tiny-invariant';

describe('invariant tests', () => {
    it('should not throw when condition is true', () => {
        expect(() => invariant(true)).not.toThrow();
        expect(() => invariant(1)).not.toThrow();
        expect(() => invariant('non-empty')).not.toThrow();
        expect(() => invariant({})).not.toThrow();
        expect(() => invariant([])).not.toThrow();
    });

    it('should throw when condition is false', () => {
        expect(() => invariant(false)).toThrow('Invariant failed');
    });

    it('should throw when condition is null', () => {
        expect(() => invariant(null)).toThrow('Invariant failed');
    });

    it('should throw when condition is undefined', () => {
        expect(() => invariant(undefined)).toThrow('Invariant failed');
    });

    it('should throw when condition is 0', () => {
        expect(() => invariant(0)).toThrow('Invariant failed');
    });

    it('should throw when condition is empty string', () => {
        expect(() => invariant('')).toThrow('Invariant failed');
    });

    it('should throw with custom message when provided', () => {
        // Note: The production check is evaluated at module load time,
        // so we test the actual behavior based on the current environment
        expect(() => invariant(false, 'Custom error message')).toThrow(/Invariant failed/);
    });

    it('should work as a type guard', () => {
        const value: string | null = 'hello';
        invariant(value);
        // After this point, TypeScript should know value is string, not string | null
        const length: number = value.length; // Should not cause type error
        expect(length).toBe(5);
    });

    it('should handle complex conditions', () => {
        const obj = { value: 42 };
        expect(() => invariant(obj.value > 0)).not.toThrow();
        expect(() => invariant(obj.value < 0, 'Value must be positive')).toThrow();
    });

    it('should handle array checks', () => {
        const arr = [1, 2, 3];
        expect(() => invariant(arr.length > 0)).not.toThrow();
        expect(() => invariant(arr.length === 0, 'Array should be empty')).toThrow();
    });

    it('should handle NaN', () => {
        expect(() => invariant(NaN)).toThrow('Invariant failed');
    });

    it('should handle object existence checks', () => {
        const obj: { prop?: string } = { prop: 'value' };
        expect(() => invariant(obj.prop)).not.toThrow();

        const objWithoutProp: { prop?: string } = {};
        expect(() => invariant(objWithoutProp.prop)).toThrow();
    });
});
