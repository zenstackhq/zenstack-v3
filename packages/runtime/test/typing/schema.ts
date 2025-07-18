//////////////////////////////////////////////////////////////////////////////////////////////
// DO NOT MODIFY THIS FILE                                                                  //
// This file is automatically generated by ZenStack CLI and should not be manually updated. //
//////////////////////////////////////////////////////////////////////////////////////////////

/* eslint-disable */

import { type SchemaDef, type OperandExpression, ExpressionUtils } from "../../dist/schema";
export const schema = {
    provider: {
        type: "sqlite"
    },
    models: {
        User: {
            fields: {
                id: {
                    type: "Int",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("autoincrement") }] }],
                    default: ExpressionUtils.call("autoincrement")
                },
                createdAt: {
                    type: "DateTime",
                    attributes: [{ name: "@default", args: [{ name: "value", value: ExpressionUtils.call("now") }] }],
                    default: ExpressionUtils.call("now")
                },
                updatedAt: {
                    type: "DateTime",
                    updatedAt: true,
                    attributes: [{ name: "@updatedAt" }]
                },
                name: {
                    type: "String"
                },
                email: {
                    type: "String",
                    unique: true,
                    attributes: [{ name: "@unique" }]
                },
                role: {
                    type: "Role",
                    attributes: [{ name: "@default", args: [{ name: "value", value: ExpressionUtils.literal("USER") }] }],
                    default: "USER"
                },
                posts: {
                    type: "Post",
                    array: true,
                    relation: { opposite: "author" }
                },
                profile: {
                    type: "Profile",
                    optional: true,
                    relation: { opposite: "user" }
                },
                postCount: {
                    type: "Int",
                    attributes: [{ name: "@computed" }],
                    computed: true
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "Int" },
                email: { type: "String" }
            },
            computedFields: {
                postCount(): OperandExpression<number> {
                    throw new Error("This is a stub for computed field");
                }
            }
        },
        Post: {
            fields: {
                id: {
                    type: "Int",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("autoincrement") }] }],
                    default: ExpressionUtils.call("autoincrement")
                },
                title: {
                    type: "String"
                },
                content: {
                    type: "String"
                },
                author: {
                    type: "User",
                    attributes: [{ name: "@relation", args: [{ name: "fields", value: ExpressionUtils.array([ExpressionUtils.field("authorId")]) }, { name: "references", value: ExpressionUtils.array([ExpressionUtils.field("id")]) }] }],
                    relation: { opposite: "posts", fields: ["authorId"], references: ["id"] }
                },
                authorId: {
                    type: "Int",
                    foreignKeyFor: [
                        "author"
                    ]
                },
                tags: {
                    type: "Tag",
                    array: true,
                    relation: { opposite: "posts" }
                },
                meta: {
                    type: "Meta",
                    optional: true,
                    relation: { opposite: "post" }
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "Int" }
            }
        },
        Profile: {
            fields: {
                id: {
                    type: "Int",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("autoincrement") }] }],
                    default: ExpressionUtils.call("autoincrement")
                },
                age: {
                    type: "Int"
                },
                region: {
                    type: "Region",
                    optional: true,
                    attributes: [{ name: "@relation", args: [{ name: "fields", value: ExpressionUtils.array([ExpressionUtils.field("regionCountry"), ExpressionUtils.field("regionCity")]) }, { name: "references", value: ExpressionUtils.array([ExpressionUtils.field("country"), ExpressionUtils.field("city")]) }] }],
                    relation: { opposite: "profiles", fields: ["regionCountry", "regionCity"], references: ["country", "city"] }
                },
                regionCountry: {
                    type: "String",
                    optional: true,
                    foreignKeyFor: [
                        "region"
                    ]
                },
                regionCity: {
                    type: "String",
                    optional: true,
                    foreignKeyFor: [
                        "region"
                    ]
                },
                user: {
                    type: "User",
                    attributes: [{ name: "@relation", args: [{ name: "fields", value: ExpressionUtils.array([ExpressionUtils.field("userId")]) }, { name: "references", value: ExpressionUtils.array([ExpressionUtils.field("id")]) }] }],
                    relation: { opposite: "profile", fields: ["userId"], references: ["id"] }
                },
                userId: {
                    type: "Int",
                    unique: true,
                    attributes: [{ name: "@unique" }],
                    foreignKeyFor: [
                        "user"
                    ]
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "Int" },
                userId: { type: "Int" }
            }
        },
        Tag: {
            fields: {
                id: {
                    type: "Int",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("autoincrement") }] }],
                    default: ExpressionUtils.call("autoincrement")
                },
                name: {
                    type: "String"
                },
                posts: {
                    type: "Post",
                    array: true,
                    relation: { opposite: "tags" }
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "Int" }
            }
        },
        Region: {
            fields: {
                country: {
                    type: "String",
                    id: true
                },
                city: {
                    type: "String",
                    id: true
                },
                zip: {
                    type: "String",
                    optional: true
                },
                profiles: {
                    type: "Profile",
                    array: true,
                    relation: { opposite: "region" }
                }
            },
            attributes: [
                { name: "@@id", args: [{ name: "fields", value: ExpressionUtils.array([ExpressionUtils.field("country"), ExpressionUtils.field("city")]) }] }
            ],
            idFields: ["country", "city"],
            uniqueFields: {
                country_city: { country: { type: "String" }, city: { type: "String" } }
            }
        },
        Meta: {
            fields: {
                id: {
                    type: "Int",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("autoincrement") }] }],
                    default: ExpressionUtils.call("autoincrement")
                },
                reviewed: {
                    type: "Boolean"
                },
                published: {
                    type: "Boolean"
                },
                post: {
                    type: "Post",
                    attributes: [{ name: "@relation", args: [{ name: "fields", value: ExpressionUtils.array([ExpressionUtils.field("postId")]) }, { name: "references", value: ExpressionUtils.array([ExpressionUtils.field("id")]) }] }],
                    relation: { opposite: "meta", fields: ["postId"], references: ["id"] }
                },
                postId: {
                    type: "Int",
                    unique: true,
                    attributes: [{ name: "@unique" }],
                    foreignKeyFor: [
                        "post"
                    ]
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "Int" },
                postId: { type: "Int" }
            }
        }
    },
    enums: {
        Role: {
            ADMIN: "ADMIN",
            USER: "USER"
        }
    },
    authType: "User",
    plugins: {}
} as const satisfies SchemaDef;
export type SchemaType = typeof schema;
