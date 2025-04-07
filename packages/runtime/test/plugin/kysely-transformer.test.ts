import {
    AndNode,
    BinaryOperationNode,
    ColumnNode,
    OperatorNode,
    ReferenceNode,
    SelectQueryNode,
    TableNode,
    ValueNode,
    WhereNode,
} from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZenStackClient, type ClientContract } from '../../src';
import { schema } from '../test-schema';

describe('Entity lifecycle tests', () => {
    let _client: ClientContract<typeof schema>;

    beforeEach(async () => {
        _client = await new ZenStackClient(schema);
        await _client.$pushSchema();
    });

    it('supports transforming kysely queries', async () => {
        const client = _client.$use({
            id: 'test-plugin',
            transformKyselyQuery(args) {
                if (SelectQueryNode.is(args.node)) {
                    // inject filter: email = 'u2@test.com'
                    const additionalFilter = BinaryOperationNode.create(
                        ReferenceNode.create(
                            ColumnNode.create('email'),
                            TableNode.create('User')
                        ),
                        OperatorNode.create('='),
                        ValueNode.create('u2@test.com')
                    );
                    args.node = {
                        ...args.node,
                        where: WhereNode.create(
                            args.node.where
                                ? AndNode.create(
                                      args.node.where.where,
                                      additionalFilter
                                  )
                                : additionalFilter
                        ),
                    };
                }
                return args.node;
            },
        });

        const user = await client.user.create({
            data: { email: 'u1@test.com' },
        });

        await expect(
            client.user.findFirst({
                where: { id: user.id },
            })
        ).toResolveNull();

        await client.user.update({
            where: { id: user.id },
            data: { email: 'u2@test.com' },
        });
        await expect(
            client.user.findFirst({
                where: { id: user.id },
            })
        ).resolves.toMatchObject({ id: user.id });
    });

    it('supports transforming kysely results', async () => {
        const client = _client.$use({
            id: 'test-plugin',
            async transformKyselyResult(args) {
                args.result.rows.forEach((row) => {
                    (row as any).happy = true;
                });
                return args.result;
            },
        });
        await expect(
            client.user.create({
                data: { email: 'u1@test.com' },
            })
        ).resolves.toMatchObject({ email: 'u1@test.com', happy: true });
    });
});
