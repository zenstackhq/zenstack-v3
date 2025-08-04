import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@zenstackhq/vitest-config/base';

export default mergeConfig(base, defineConfig({}));
