import config from '@zenstackhq/eslint-config/base.js';
import tseslint from 'typescript-eslint';

/** @type {import("eslint").Linter.Config} */
export default tseslint.config(config, {
    rules: {
        '@typescript-eslint/no-unused-expressions': 'off',
    },
});
