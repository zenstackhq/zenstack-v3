import { RPCApiHandler } from '@zenstackhq/server/api';
import { createEventHandler } from '@zenstackhq/server/nuxt';
import { schema } from '~~/zenstack/schema';

const handler = createEventHandler({
    apiHandler: new RPCApiHandler({ schema }),
    // fully open ZenStackClient is used here for demo purposes only, in a real application,
    // you should use one with access policies enabled
    getClient: () => db,
});

export default handler;
