import { describe, expect, it } from 'vitest';
import { lowerCaseFirst } from '../src/lower-case-first';
import { upperCaseFirst } from '../src/upper-case-first';

describe('lowerCaseFirst tests', () => {
    it('should lowercase the first character', () => {
        expect(lowerCaseFirst('Hello')).toBe('hello');
        expect(lowerCaseFirst('WORLD')).toBe('wORLD');
        expect(lowerCaseFirst('A')).toBe('a');
    });

    it('should handle already lowercase strings', () => {
        expect(lowerCaseFirst('hello')).toBe('hello');
        expect(lowerCaseFirst('world')).toBe('world');
    });

    it('should handle empty string', () => {
        expect(lowerCaseFirst('')).toBe('');
    });

    it('should handle strings with numbers', () => {
        expect(lowerCaseFirst('123abc')).toBe('123abc');
    });

    it('should handle strings with special characters', () => {
        expect(lowerCaseFirst('!Hello')).toBe('!Hello');
        expect(lowerCaseFirst('@World')).toBe('@World');
    });
});

describe('upperCaseFirst tests', () => {
    it('should uppercase the first character', () => {
        expect(upperCaseFirst('hello')).toBe('Hello');
        expect(upperCaseFirst('world')).toBe('World');
        expect(upperCaseFirst('a')).toBe('A');
    });

    it('should handle already uppercase strings', () => {
        expect(upperCaseFirst('Hello')).toBe('Hello');
        expect(upperCaseFirst('WORLD')).toBe('WORLD');
    });

    it('should handle empty string', () => {
        expect(upperCaseFirst('')).toBe('');
    });

    it('should handle strings with numbers', () => {
        expect(upperCaseFirst('123abc')).toBe('123abc');
    });

    it('should handle strings with special characters', () => {
        expect(upperCaseFirst('!hello')).toBe('!hello');
        expect(upperCaseFirst('@world')).toBe('@world');
    });
});
