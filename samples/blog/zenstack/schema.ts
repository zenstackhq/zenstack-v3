import { type SchemaDef } from "@zenstackhq/runtime/schema";
export const schema = {
    provider: "sqlite",
    models: {
        User: {
            dbTable: "User",
            fields: {
                id: {
                    type: "String",
                    id: true,
                    default: { call: "cuid" },
                    generator: "cuid"
                },
                createdAt: {
                    type: "DateTime",
                    default: { call: "now" }
                },
                updatedAt: {
                    type: "DateTime",
                    updatedAt: true
                },
                email: {
                    type: "String",
                    unique: true
                },
                role: {
                    type: "Role",
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
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "String" },
                email: { type: "String" }
            }
        },
        Profile: {
            dbTable: "Profile",
            fields: {
                id: {
                    type: "String",
                    id: true,
                    default: { call: "cuid" },
                    generator: "cuid"
                },
                bio: {
                    type: "String",
                    optional: true
                },
                age: {
                    type: "Int",
                    optional: true
                },
                user: {
                    type: "User",
                    optional: true,
                    relation: { opposite: "profile", fields: ["userId"], references: ["id"] }
                },
                userId: {
                    type: "String",
                    unique: true,
                    optional: true
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "String" },
                userId: { type: "String" }
            }
        },
        Post: {
            dbTable: "Post",
            fields: {
                id: {
                    type: "String",
                    id: true,
                    default: { call: "cuid" },
                    generator: "cuid"
                },
                createdAt: {
                    type: "DateTime",
                    default: { call: "now" }
                },
                updatedAt: {
                    type: "DateTime",
                    updatedAt: true
                },
                title: {
                    type: "String"
                },
                content: {
                    type: "String"
                },
                published: {
                    type: "Boolean"
                },
                author: {
                    type: "User",
                    relation: { opposite: "posts", fields: ["authorId"], references: ["id"] }
                },
                authorId: {
                    type: "String"
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "String" }
            }
        }
    },
    enums: {
        Role: {
            ADMIN: "ADMIN",
            USER: "USER"
        }
    },
    authModel: "User"
} as const satisfies SchemaDef;
export type SchemaType = typeof schema;
