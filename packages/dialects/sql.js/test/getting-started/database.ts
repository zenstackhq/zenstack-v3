import type { Database } from './types';

import { Kysely } from 'kysely';
import initSqlJs from 'sql.js';

import { SqlJsDialect } from '../../src';

const SqlJsStatic = await initSqlJs();

export const db = new Kysely<Database>({
    dialect: new SqlJsDialect({ sqlJs: new SqlJsStatic.Database() }),
});
