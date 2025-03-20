//////////////////////////////////////////////////////////////////////////////////////////////
// DO NOT MODIFY THIS FILE                                                                  //
// This file is automatically generated by ZenStack CLI and should not be manually updated. //
//////////////////////////////////////////////////////////////////////////////////////////////

import { type SchemaDef, type OperandExpression } from "@zenstackhq/runtime/schema";
import path from "node:path";
import url from "node:url";
import SQLite from "better-sqlite3";
export const schema = {
    provider: {
        type: "sqlite",
        dialectConfigProvider: function (): any {
            return { database: new SQLite(path.resolve(typeof __dirname !== 'undefined'
        ? __dirname
        : path.dirname(url.fileURLToPath(import.meta.url)), "./dev.db")) };
        }
    },
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
                emailDomain: {
                    type: "String",
                    computed: true
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
            },
            computedFields: {
                emailDomain(): OperandExpression<string> {
                    throw new Error("This is a stub for computed field");
                }
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
