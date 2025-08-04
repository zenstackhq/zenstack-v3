Forked from https://github.com/betarixm/kysely-sql-js

## Usage

```ts
import { type GeneratedAlways, Kysely } from 'kysely';
import initSqlJs from 'sql.js';

import { SqlJsDialect } from '@zenstackhq/kysely-sql-js';

interface Database {
    person: {
        id: GeneratedAlways<number>;
        first_name: string | null;
        last_name: string | null;
        age: number;
    };
}

const SqlJsStatic = await initSqlJs();

export const db = new Kysely<Database>({
    dialect: new SqlJsDialect({ sqlJs: new SqlJsStatic.Database() }),
});
```
