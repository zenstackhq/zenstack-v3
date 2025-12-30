import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

const schema = `
model User {
    id      Int    @id
    uuid    String @default(uuid(4, "user_uuid_%s"))
    uuid7   String @default(uuid(7, "user_uuid7_%s"))
    cuid    String @default(cuid(2, "user_cuid_%s"))
    cuid2   String @default(cuid(2, "user_cuid2_%s"))
    nanoid  String @default(nanoid(21, "user_nanoid_%s"))
    nanoid8 String @default(nanoid(8, "user_nanoid8_%s"))
    ulid    String @default(ulid("user_ulid_%s"))
    posts   Post[]
}

model Post {
    id       Int       @id
    uuid     String    @default(uuid(4, "post_uuid_%s"))
    uuid7    String    @default(uuid(7, "post_uuid7_%s"))
    cuid     String    @default(cuid(2, "post_cuid_%s"))
    cuid2    String    @default(cuid(2, "post_cuid2_%s"))
    nanoid   String    @default(nanoid(21, "post_nanoid_%s"))
    nanoid8  String    @default(nanoid(8, "post_nanoid8_%s"))
    ulid     String    @default(ulid("post_ulid_%s"))
    userId   Int
    user     User      @relation(fields: [userId], references: [id])
    comments Comment[]
}

model Comment {
    id      Int    @id
    uuid    String @default(uuid(4, "comment_uuid_%s"))
    uuid7   String @default(uuid(7, "comment_uuid7_%s"))
    cuid    String @default(cuid(2, "comment_cuid_%s"))
    cuid2   String @default(cuid(2, "comment_cuid2_%s"))
    nanoid  String @default(nanoid(21, "comment_nanoid_%s"))
    nanoid8 String @default(nanoid(8, "comment_nanoid8_%s"))
    ulid    String @default(ulid("comment_ulid_%s"))
    postId  Int
    post    Post   @relation(fields: [postId], references: [id])
}
`;

describe('generated id format strings', () => {
    it('supports top-level ids', async () => {
        const client = await createTestClient(schema);

        const user = await client.user.create({
            data: {
                id: 1,
            },
        });
        expect(user.uuid).toMatch(/^user_uuid_/);
        expect(user.uuid7).toMatch(/^user_uuid7_/);
        expect(user.cuid).toMatch(/^user_cuid_/);
        expect(user.cuid2).toMatch(/^user_cuid2_/);
        expect(user.nanoid).toMatch(/^user_nanoid_/);
        expect(user.nanoid8).toMatch(/^user_nanoid8_/);
        expect(user.ulid).toMatch(/^user_ulid_/);
    });

    it('supports nested ids', async () => {
        const client = await createTestClient(schema);

        const user = await client.user.create({
            data: {
                id: 1,

                posts: {
                    create: {
                        id: 1,
                    },
                },
            },
        });
        expect(user.uuid).toMatch(/^user_uuid_/);
        expect(user.uuid7).toMatch(/^user_uuid7_/);
        expect(user.cuid).toMatch(/^user_cuid_/);
        expect(user.cuid2).toMatch(/^user_cuid2_/);
        expect(user.nanoid).toMatch(/^user_nanoid_/);
        expect(user.nanoid8).toMatch(/^user_nanoid8_/);
        expect(user.ulid).toMatch(/^user_ulid_/);

        const post = await client.post.findUniqueOrThrow({ where: { id: 1 } });
        expect(post.uuid).toMatch(/^post_uuid_/);
        expect(post.uuid7).toMatch(/^post_uuid7_/);
        expect(post.cuid).toMatch(/^post_cuid_/);
        expect(post.cuid2).toMatch(/^post_cuid2_/);
        expect(post.nanoid).toMatch(/^post_nanoid_/);
        expect(post.nanoid8).toMatch(/^post_nanoid8_/);
        expect(post.ulid).toMatch(/^post_ulid_/);
    });

    it('supports deeply nested ids', async () => {
        const client = await createTestClient(schema);

        const user = await client.user.create({
            data: {
                id: 1,

                posts: {
                    create: {
                        id: 1,

                        comments: {
                            create: {
                                id: 1,
                            },
                        },
                    },
                },
            },
        });
        expect(user.uuid).toMatch(/^user_uuid_/);
        expect(user.uuid7).toMatch(/^user_uuid7_/);
        expect(user.cuid).toMatch(/^user_cuid_/);
        expect(user.cuid2).toMatch(/^user_cuid2_/);
        expect(user.nanoid).toMatch(/^user_nanoid_/);
        expect(user.nanoid8).toMatch(/^user_nanoid8_/);
        expect(user.ulid).toMatch(/^user_ulid_/);

        const post = await client.post.findUniqueOrThrow({ where: { id: 1 } });
        expect(post.uuid).toMatch(/^post_uuid_/);
        expect(post.uuid7).toMatch(/^post_uuid7_/);
        expect(post.cuid).toMatch(/^post_cuid_/);
        expect(post.cuid2).toMatch(/^post_cuid2_/);
        expect(post.nanoid).toMatch(/^post_nanoid_/);
        expect(post.nanoid8).toMatch(/^post_nanoid8_/);
        expect(post.ulid).toMatch(/^post_ulid_/);

        const comment = await client.comment.findUniqueOrThrow({ where: { id: 1 } });
        expect(comment.uuid).toMatch(/^comment_uuid_/);
        expect(comment.uuid7).toMatch(/^comment_uuid7_/);
        expect(comment.cuid).toMatch(/^comment_cuid_/);
        expect(comment.cuid2).toMatch(/^comment_cuid2_/);
        expect(comment.nanoid).toMatch(/^comment_nanoid_/);
        expect(comment.nanoid8).toMatch(/^comment_nanoid8_/);
        expect(comment.ulid).toMatch(/^comment_ulid_/);
    });

    it('supports escaped placeholders and edge cases', async () => {
        const escapedSchema = `
model EscapedTest {
    id                Int    @id
    consecutive       String @default(uuid(4, "%s%s"))
    mixedEscaped      String @default(uuid(4, "\\\\%s_%s_end"))
    mixedEscaped2      String @default(uuid(4, "%s_\\\\%s_end"))
    mixedEscaped3      String @default(uuid(4, "\\\\%s_\\\\%s_%s"))
    startWithPattern  String @default(uuid(4, "%s_suffix"))
    endWithPattern    String @default(uuid(4, "prefix_%s"))
}
`;
        const client = await createTestClient(escapedSchema);

        const record = await client.escapedTest.create({
            data: {
                id: 1,
            },
        });

        // Consecutive %s%s should both be replaced
        expect(record.consecutive).toMatch(/^[0-9a-f-]{36}[0-9a-f-]{36}$/);

        // Mixed: first \%s stays as %s, second %s is replaced
        expect(record.mixedEscaped).toMatch(/^%s_[0-9a-f-]{36}_end$/);

        // Mixed: first %s is replaced, second \%s stays as %s
        expect(record.mixedEscaped2).toMatch(/^[0-9a-f-]{36}_%s_end$/);

        // Mixed: first and second \%s stays as %s, third %s is replaced
        expect(record.mixedEscaped3).toMatch(/^%s_%s_[0-9a-f-]{36}$/);

        // Pattern at start
        expect(record.startWithPattern).toMatch(/^[0-9a-f-]{36}_suffix$/);

        // Pattern at end
        expect(record.endWithPattern).toMatch(/^prefix_[0-9a-f-]{36}$/);
    });
});
