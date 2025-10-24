import { type SchemaDef, ExpressionUtils } from "@zenstackhq/runtime/schema";
export const schema = {
    provider: {
        type: "postgresql"
    },
    models: {
        User: {
            name: "User",
            fields: {
                id: {
                    name: "id",
                    type: "String",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("uuid") }] }],
                    default: ExpressionUtils.call("uuid")
                },
                name: {
                    name: "name",
                    type: "String"
                },
                email: {
                    name: "email",
                    type: "String",
                    unique: true,
                    attributes: [{ name: "@unique" }]
                },
                createdAt: {
                    name: "createdAt",
                    type: "DateTime",
                    attributes: [{ name: "@default", args: [{ name: "value", value: ExpressionUtils.call("now") }] }],
                    default: ExpressionUtils.call("now")
                },
                updatedAt: {
                    name: "updatedAt",
                    type: "DateTime",
                    updatedAt: true,
                    attributes: [{ name: "@updatedAt" }]
                },
                posts: {
                    name: "posts",
                    type: "Post",
                    array: true,
                    relation: { opposite: "author" }
                }
            },
            attributes: [
                { name: "@@map", args: [{ name: "name", value: ExpressionUtils.literal("users") }] }
            ],
            idFields: ["id"],
            uniqueFields: {
                id: { type: "String" },
                email: { type: "String" }
            }
        },
        Post: {
            name: "Post",
            fields: {
                id: {
                    name: "id",
                    type: "String",
                    id: true,
                    attributes: [{ name: "@id" }, { name: "@default", args: [{ name: "value", value: ExpressionUtils.call("cuid") }] }],
                    default: ExpressionUtils.call("cuid")
                },
                title: {
                    name: "title",
                    type: "String"
                },
                published: {
                    name: "published",
                    type: "Boolean",
                    attributes: [{ name: "@default", args: [{ name: "value", value: ExpressionUtils.literal(false) }] }],
                    default: false
                },
                author: {
                    name: "author",
                    type: "User",
                    attributes: [{ name: "@relation", args: [{ name: "fields", value: ExpressionUtils.array([ExpressionUtils.field("authorId")]) }, { name: "references", value: ExpressionUtils.array([ExpressionUtils.field("id")]) }, { name: "onDelete", value: ExpressionUtils.literal("Cascade") }] }],
                    relation: { opposite: "posts", fields: ["authorId"], references: ["id"], onDelete: "Cascade" }
                },
                authorId: {
                    name: "authorId",
                    type: "String",
                    foreignKeyFor: [
                        "author"
                    ]
                }
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "String" }
            }
        }
    },
    authType: "User",
    plugins: {}
} as const satisfies SchemaDef;
export type SchemaType = typeof schema;
