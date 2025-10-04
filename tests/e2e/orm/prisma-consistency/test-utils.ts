import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { expect } from 'vitest';

export interface ValidationResult {
    success: boolean;
}

export class ZenStackValidationTester {
    private testDir: string;
    private schemaPath: string;
    private cliPath: string;

    constructor(testDir: string) {
        this.testDir = testDir;
        this.schemaPath = join(testDir, 'zenstack', 'schema.zmodel');

        // Get path relative to current test file
        const currentDir = dirname(fileURLToPath(import.meta.url));
        this.cliPath = join(currentDir, '../../node_modules/@zenstackhq/cli/bin/cli');
    }

    private setupTestDirectory() {
        if (existsSync(this.testDir)) {
            rmSync(this.testDir, { recursive: true, force: true });
        }
        mkdirSync(this.testDir, { recursive: true });
        mkdirSync(join(this.testDir, 'zenstack'), { recursive: true });

        // Create package.json
        writeFileSync(
            join(this.testDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'zenstack-validation-test',
                    version: '1.0.0',
                    private: true,
                },
                null,
                2,
            ),
        );
    }

    public runValidation(schema: string): ValidationResult {
        this.setupTestDirectory();
        writeFileSync(this.schemaPath, schema);

        try {
            execSync(`node ${this.cliPath} generate`, {
                cwd: this.testDir,
                stdio: 'pipe',
                encoding: 'utf8',
            });

            return {
                success: true,
            };
        } catch (error: any) {
            return {
                success: false,
            };
        }
    }

    public cleanup() {
        if (existsSync(this.testDir)) {
            rmSync(this.testDir, { recursive: true, force: true });
        }
    }
}

export function createTestDir(): string {
    return join(tmpdir(), 'zenstack-validation-test-' + randomUUID());
}

export function expectValidationSuccess(result: ValidationResult) {
    expect(result.success).toBe(true);
}

export function expectValidationFailure(result: ValidationResult) {
    expect(result.success).toBe(false);
}

export const baseSchema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`;

export const sqliteSchema = `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`;
