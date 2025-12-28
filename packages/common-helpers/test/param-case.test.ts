import { describe, expect, it } from 'vitest';
import { paramCase } from '../src/param-case';

describe('paramCase tests', () => {
    it('should convert camelCase to param-case', () => {
        expect(paramCase('camelCase')).toBe('camel-case');
        expect(paramCase('userName')).toBe('user-name');
        expect(paramCase('firstName')).toBe('first-name');
    });

    it('should convert PascalCase to param-case', () => {
        expect(paramCase('PascalCase')).toBe('pascal-case');
        expect(paramCase('UserName')).toBe('user-name');
        expect(paramCase('FirstName')).toBe('first-name');
    });

    it('should handle all uppercase strings', () => {
        expect(paramCase('SCREAMING_SNAKE_CASE')).toBe('screaming-snake-case');
        expect(paramCase('HTTP')).toBe('http');
        expect(paramCase('HTTPServer')).toBe('http-server');
    });

    it('should handle snake_case', () => {
        expect(paramCase('snake_case')).toBe('snake-case');
        expect(paramCase('user_name')).toBe('user-name');
    });

    it('should handle strings with numbers', () => {
        // Numbers adjacent to letters don't create splits
        expect(paramCase('version2')).toBe('version2');
        expect(paramCase('user123Name')).toBe('user123-name');
        expect(paramCase('v2API')).toBe('v2-api');
    });

    it('should handle strings with spaces', () => {
        expect(paramCase('hello world')).toBe('hello-world');
        expect(paramCase('user name')).toBe('user-name');
    });

    it('should handle strings with special characters', () => {
        expect(paramCase('hello@world')).toBe('hello-world');
        expect(paramCase('user!name')).toBe('user-name');
        expect(paramCase('first$last')).toBe('first-last');
    });

    it('should handle mixed formats', () => {
        expect(paramCase('XMLHttpRequest')).toBe('xml-http-request');
        expect(paramCase('newCustomerId')).toBe('new-customer-id');
        expect(paramCase('innerHtml')).toBe('inner-html');
    });

    it('should handle single character strings', () => {
        expect(paramCase('a')).toBe('a');
        expect(paramCase('A')).toBe('a');
    });

    it('should handle empty string', () => {
        expect(paramCase('')).toBe('');
    });

    it('should strip leading and trailing special characters', () => {
        expect(paramCase('-hello-world-')).toBe('hello-world');
        expect(paramCase('_hello_world_')).toBe('hello-world');
        expect(paramCase('!!hello!world!!')).toBe('hello-world');
    });

    it('should handle consecutive uppercase letters', () => {
        expect(paramCase('HTTPSConnection')).toBe('https-connection');
        expect(paramCase('IOError')).toBe('io-error');
    });
});
