import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.base.config';

export default mergeConfig(base, defineConfig({}));
