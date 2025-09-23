import { invariant } from '@zenstackhq/common-helpers';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { describe, expect, it } from 'vitest';
import { loadDocument } from '../src';
import { DataModel, isDataModel } from '../src/ast';

describe('Import tests', () => {
    it('merges declarations', async () => {
        const { name } = tmp.dirSync();
        fs.writeFileSync(
            path.join(name, 'a.zmodel'),
            `
datasource db {
  provider = 'sqlite'
  url      = 'file:./dev.db'
}
        
model A {
  id Int @id
  name String
}
        `,
        );
        fs.writeFileSync(
            path.join(name, 'b.zmodel'),
            `
import './a'
model B {
  id Int @id
}
        `,
        );

        const model = await expectLoaded(path.join(name, 'b.zmodel'));
        expect(model.declarations.filter(isDataModel)).toHaveLength(2);
        expect(model.imports).toHaveLength(0);
    });

    it('resolves imported symbols', async () => {
        const { name } = tmp.dirSync();
        fs.writeFileSync(
            path.join(name, 'a.zmodel'),
            `
enum Role {
  Admin
  User
}
  `,
        );
        fs.writeFileSync(
            path.join(name, 'b.zmodel'),
            `
import './a'

datasource db {
  provider = 'sqlite'
  url      = 'file:./dev.db'
}

model User {
  id Int @id
  role Role
}
`,
        );

        const model = await expectLoaded(path.join(name, 'b.zmodel'));
        expect((model.declarations[1] as DataModel).fields[1].type.reference?.ref?.name).toBe('Role');
    });

    it('supports cyclic imports', async () => {
        const { name } = tmp.dirSync();
        fs.writeFileSync(
            path.join(name, 'a.zmodel'),
            `
import './b'

datasource db {
  provider = 'sqlite'
  url      = 'file:./dev.db'
}

model A {
  id Int @id
  b B?
}
        `,
        );
        fs.writeFileSync(
            path.join(name, 'b.zmodel'),
            `
import './a'
model B {
  id Int @id
  a A @relation(fields: [aId], references: [id])
  aId Int @unique
}
`,
        );

        const modelB = await expectLoaded(path.join(name, 'b.zmodel'));
        expect((modelB.declarations[0] as DataModel).fields[1].type.reference?.ref?.name).toBe('A');
        const modelA = await expectLoaded(path.join(name, 'a.zmodel'));
        expect((modelA.declarations[1] as DataModel).fields[1].type.reference?.ref?.name).toBe('B');
    });

    async function expectLoaded(file: string) {
        const result = await loadDocument(file);
        if (!result.success) {
            console.error('Errors:', result.errors);
            throw new Error(`Failed to load document from ${file}`);
        }
        invariant(result.success);
        return result.model;
    }
});
