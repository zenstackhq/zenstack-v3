import { ZenStackClient } from '@zenstackhq/orm';
import { type SchemaDef } from '@zenstackhq/orm/schema';
import SQLite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { describe, expect, it } from 'vitest';

const schema = {
    provider: {
        type: 'sqlite'
    },
    models: {
        User: {
            name: 'User',
            fields: {
                id: {
                    name: 'id',
                    type: 'Int',
                    id: true,
                    attributes: [
                        {
                            name: '@id'
                        }
                    ]
                },
                uuid: {
                    name: 'uuid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'uuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 4
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'user_uuid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'uuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 4
                            },
                            {
                                kind: 'literal',
                                value: 'user_uuid_%s'
                            }
                        ]
                    }
                },
                uuid7: {
                    name: 'uuid7',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'uuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 7
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'user_uuid7_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'uuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 7
                            },
                            {
                                kind: 'literal',
                                value: 'user_uuid7_%s'
                            }
                        ]
                    }
                },
                cuid: {
                    name: 'cuid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 2
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'user_cuid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'cuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 2
                            },
                            {
                                kind: 'literal',
                                value: 'user_cuid_%s'
                            }
                        ]
                    }
                },
                cuid2: {
                    name: 'cuid2',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 2
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'user_cuid2_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'cuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 2
                            },
                            {
                                kind: 'literal',
                                value: 'user_cuid2_%s'
                            }
                        ]
                    }
                },
                nanoid: {
                    name: 'nanoid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'nanoid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 21
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'user_nanoid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'nanoid',
                        args: [
                            {
                                kind: 'literal',
                                value: 21
                            },
                            {
                                kind: 'literal',
                                value: 'user_nanoid_%s'
                            }
                        ]
                    }
                },
                nanoid8: {
                    name: 'nanoid8',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'nanoid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 8
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'user_nanoid8_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'nanoid',
                        args: [
                            {
                                kind: 'literal',
                                value: 8
                            },
                            {
                                kind: 'literal',
                                value: 'user_nanoid8_%s'
                            }
                        ]
                    }
                },
                ulid: {
                    name: 'ulid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'ulid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 'user_ulid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'ulid',
                        args: [
                            {
                                kind: 'literal',
                                value: 'user_ulid_%s'
                            }
                        ]
                    }
                },
                posts: {
                    name: 'posts',
                    type: 'Post',
                    array: true,
                    relation: {
                        opposite: 'user'
                    }
                }
            },
            idFields: [
                'id'
            ],
            uniqueFields: {
                id: {
                    type: 'Int'
                }
            }
        },
        Post: {
            name: 'Post',
            fields: {
                id: {
                    name: 'id',
                    type: 'Int',
                    id: true,
                    attributes: [
                        {
                            name: '@id'
                        }
                    ]
                },
                uuid: {
                    name: 'uuid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'uuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 4
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'post_uuid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'uuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 4
                            },
                            {
                                kind: 'literal',
                                value: 'post_uuid_%s'
                            }
                        ]
                    }
                },
                uuid7: {
                    name: 'uuid7',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'uuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 7
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'post_uuid7_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'uuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 7
                            },
                            {
                                kind: 'literal',
                                value: 'post_uuid7_%s'
                            }
                        ]
                    }
                },
                cuid: {
                    name: 'cuid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 2
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'post_cuid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'cuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 2
                            },
                            {
                                kind: 'literal',
                                value: 'post_cuid_%s'
                            }
                        ]
                    }
                },
                cuid2: {
                    name: 'cuid2',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 2
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'post_cuid2_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'cuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 2
                            },
                            {
                                kind: 'literal',
                                value: 'post_cuid2_%s'
                            }
                        ]
                    }
                },
                nanoid: {
                    name: 'nanoid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'nanoid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 21
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'post_nanoid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'nanoid',
                        args: [
                            {
                                kind: 'literal',
                                value: 21
                            },
                            {
                                kind: 'literal',
                                value: 'post_nanoid_%s'
                            }
                        ]
                    }
                },
                nanoid8: {
                    name: 'nanoid8',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'nanoid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 8
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'post_nanoid8_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'nanoid',
                        args: [
                            {
                                kind: 'literal',
                                value: 8
                            },
                            {
                                kind: 'literal',
                                value: 'post_nanoid8_%s'
                            }
                        ]
                    }
                },
                ulid: {
                    name: 'ulid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'ulid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 'post_ulid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'ulid',
                        args: [
                            {
                                kind: 'literal',
                                value: 'post_ulid_%s'
                            }
                        ]
                    }
                },
                userId: {
                    name: 'userId',
                    type: 'Int',
                    foreignKeyFor: [
                        'user'
                    ]
                },
                user: {
                    name: 'user',
                    type: 'User',
                    attributes: [
                        {
                            name: '@relation',
                            args: [
                                {
                                    name: 'fields',
                                    value: {
                                        kind: 'array',
                                        items: [
                                            {
                                                kind: 'field',
                                                field: 'userId'
                                            }
                                        ]
                                    }
                                },
                                {
                                    name: 'references',
                                    value: {
                                        kind: 'array',
                                        items: [
                                            {
                                                kind: 'field',
                                                field: 'id'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    relation: {
                        opposite: 'posts',
                        fields: [
                            'userId'
                        ],
                        references: [
                            'id'
                        ]
                    }
                },
                comments: {
                    name: 'comments',
                    type: 'Comment',
                    array: true,
                    relation: {
                        opposite: 'post'
                    }
                }
            },
            idFields: [
                'id'
            ],
            uniqueFields: {
                id: {
                    type: 'Int'
                }
            }
        },
        Comment: {
            name: 'Comment',
            fields: {
                id: {
                    name: 'id',
                    type: 'Int',
                    id: true,
                    attributes: [
                        {
                            name: '@id'
                        }
                    ]
                },
                uuid: {
                    name: 'uuid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'uuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 4
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'comment_uuid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'uuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 4
                            },
                            {
                                kind: 'literal',
                                value: 'comment_uuid_%s'
                            }
                        ]
                    }
                },
                uuid7: {
                    name: 'uuid7',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'uuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 7
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'comment_uuid7_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'uuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 7
                            },
                            {
                                kind: 'literal',
                                value: 'comment_uuid7_%s'
                            }
                        ]
                    }
                },
                cuid: {
                    name: 'cuid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 2
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'comment_cuid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'cuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 2
                            },
                            {
                                kind: 'literal',
                                value: 'comment_cuid_%s'
                            }
                        ]
                    }
                },
                cuid2: {
                    name: 'cuid2',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'cuid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 2
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'comment_cuid2_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'cuid',
                        args: [
                            {
                                kind: 'literal',
                                value: 2
                            },
                            {
                                kind: 'literal',
                                value: 'comment_cuid2_%s'
                            }
                        ]
                    }
                },
                nanoid: {
                    name: 'nanoid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'nanoid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 21
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'comment_nanoid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'nanoid',
                        args: [
                            {
                                kind: 'literal',
                                value: 21
                            },
                            {
                                kind: 'literal',
                                value: 'comment_nanoid_%s'
                            }
                        ]
                    }
                },
                nanoid8: {
                    name: 'nanoid8',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'nanoid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 8
                                            },
                                            {
                                                kind: 'literal',
                                                value: 'comment_nanoid8_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'nanoid',
                        args: [
                            {
                                kind: 'literal',
                                value: 8
                            },
                            {
                                kind: 'literal',
                                value: 'comment_nanoid8_%s'
                            }
                        ]
                    }
                },
                ulid: {
                    name: 'ulid',
                    type: 'String',
                    attributes: [
                        {
                            name: '@default',
                            args: [
                                {
                                    name: 'value',
                                    value: {
                                        kind: 'call',
                                        function: 'ulid',
                                        args: [
                                            {
                                                kind: 'literal',
                                                value: 'comment_ulid_%s'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    default: {
                        kind: 'call',
                        function: 'ulid',
                        args: [
                            {
                                kind: 'literal',
                                value: 'comment_ulid_%s'
                            }
                        ]
                    }
                },
                postId: {
                    name: 'postId',
                    type: 'Int',
                    foreignKeyFor: [
                        'post'
                    ]
                },
                post: {
                    name: 'post',
                    type: 'Post',
                    attributes: [
                        {
                            name: '@relation',
                            args: [
                                {
                                    name: 'fields',
                                    value: {
                                        kind: 'array',
                                        items: [
                                            {
                                                kind: 'field',
                                                field: 'postId'
                                            }
                                        ]
                                    }
                                },
                                {
                                    name: 'references',
                                    value: {
                                        kind: 'array',
                                        items: [
                                            {
                                                kind: 'field',
                                                field: 'id'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ],
                    relation: {
                        opposite: 'comments',
                        fields: [
                            'postId'
                        ],
                        references: [
                            'id'
                        ]
                    }
                }
            },
            idFields: [
                'id'
            ],
            uniqueFields: {
                id: {
                    type: 'Int'
                }
            }
        }
    },
    authType: 'User',
    plugins: {}
} as const satisfies SchemaDef;

describe('generated id format strings', () => {
      it('supports top-level generated id format strings', async () => {
        const client = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
        await client.$pushSchema();

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

    it('supports nested generated id format strings', async () => {
        const client = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
        await client.$pushSchema();

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

    it('supports deeply nested generated id format strings', async () => {
        const client = new ZenStackClient(schema, {
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
        await client.$pushSchema();

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
});