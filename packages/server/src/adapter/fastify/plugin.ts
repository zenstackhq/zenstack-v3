import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { CommonAdapterOptions } from '../common';

/**
 * Fastify plugin options
 */
export interface PluginOptions<Schema extends SchemaDef> extends CommonAdapterOptions<Schema> {

    /**
     * Url prefix, e.g.: /api
     */
    prefix: string;

    /**
     * Callback for getting a PrismaClient for the given request
     */
    getClient: (request: FastifyRequest, reply: FastifyReply) => ClientContract<Schema> | Promise<ClientContract<Schema>>;
}

/**
 * Fastify plugin for handling CRUD requests.
 */
const pluginHandler: FastifyPluginCallback<PluginOptions<SchemaDef>> = (fastify, options, done) => {
    const prefix = options.prefix ?? '';

    fastify.all(`${prefix}/*`, async (request, reply) => {
        const client = await options.getClient(request, reply);
        if (!client) {
            reply.status(500).send({ message: 'unable to get prisma from request context' });
            return reply;
        }

        try {
            const response = await options.apiHandler.handleRequest({
                method: request.method,
                path: (request.params as any)['*'],
                query: request.query as Record<string, string | string[]>,
                requestBody: request.body,
                client,
            });
            reply.status(response.status).send(response.body);
        } catch (err) {
            reply.status(500).send({ message: `An unhandled error occurred: ${err}` });
        }

        return reply;
    });

    done();
};

const plugin = fp(pluginHandler);

export { plugin as ZenStackFastifyPlugin };
