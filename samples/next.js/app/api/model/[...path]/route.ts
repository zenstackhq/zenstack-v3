import { db } from '@/lib/db';
import { schema } from '@/zenstack/schema';
import { RPCApiHandler } from '@zenstackhq/server/api';
import { NextRequestHandler } from '@zenstackhq/server/next';

const handler = NextRequestHandler({
    apiHandler: new RPCApiHandler({ schema, log: ['debug', 'error'] }),
    // fully open ZenStackClient is used here for demo purposes only, in a real application,
    // you should use one with access policies enabled
    getClient: () => db,
    useAppDir: true,
});

export { handler as DELETE, handler as GET, handler as PATCH, handler as POST, handler as PUT };
