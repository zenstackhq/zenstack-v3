import { ZenStackClient } from '@zenstackhq/orm';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { type Overview, Role, type Role as RoleType, type User } from './models';
import { schema } from './schema';

const client = new ZenStackClient(schema, {
    dialect: new SqliteDialect({ database: new SQLite('./zenstack/test.db') }),
    procedures: {} as any,
});

async function procedures() {
    const user: User = await client.$procs.getUser(1);
    const users: User[] = await client.$procs.listUsers();
    const users2: User[] = await client.$procs.findByIds([1, 2, 3]);

    const overview: Overview = await client.$procs.overview();
    const total: number = overview.total;
    const userIds: number[] = overview.userIds;
    const rolesFromOverview: RoleType[] = overview.roles;
    const meta: unknown | undefined = overview.meta;
    console.log(total, rolesFromOverview.length);

    const role: RoleType = await client.$procs.getRole();
    const roles: RoleType[] = await client.$procs.getRoles();

    // enum values typecheck
    if (role === Role.ADMIN) {
        console.log('admin');
    }

    const n: null = await client.$procs.getNull();
    const v: void = await client.$procs.getVoid();
    const u: undefined = await client.$procs.getUndefined();

    // optional param
    const greeting1: string = await client.$procs.greet('alice');
    const greeting2: string = await client.$procs.greet();

    // Json/Bytes mapping
    const jsonResult: unknown = await client.$procs.echoJson({ hello: 'world' } as any);
    const bytesResult: Uint8Array = await client.$procs.echoBytes(new Uint8Array([1, 2, 3]));

    // backward-compatible alias
    const userAlias: User = await client.$procedures.getUser(1);

    console.log(
        user.id,
        users.length,
        users2.length,
        userIds.length,
        meta,
        greeting1,
        greeting2,
        jsonResult,
        bytesResult,
        v,
        u,
        userAlias.id,
    );
    console.log(role, roles.length, n);
}

procedures();
