//////////////////////////////////////////////////////////////////////////////////////////////
// NOTE: Test fixture schema used for TanStack Query typing tests.                            //
//////////////////////////////////////////////////////////////////////////////////////////////

 

import { type SchemaDef, ExpressionUtils } from "@zenstackhq/orm/schema";

export class SchemaType implements SchemaDef {
    provider = {
        type: "sqlite",
    } as const;

    models = {
        User: {
            name: "User",
            fields: {
                id: {
                    name: "id",
                    type: "String",
                    id: true,
                    default: ExpressionUtils.call("cuid"),
                },
                email: {
                    name: "email",
                    type: "String",
                    unique: true,
                },
            },
            idFields: ["id"],
            uniqueFields: {
                id: { type: "String" },
                email: { type: "String" },
            },
        },
    } as const;

    procedures = {
        greet: {
            params: [{ name: "name", type: "String", optional: true }] as const,
            returnType: "String",
        },
        greetMany: {
            params: [{ name: "name", type: "String", optional: true }] as const,
            returnType: "String",
            returnArray: true,
        },
        sum: {
            params: [
                { name: "a", type: "Int" },
                { name: "b", type: "Int" },
            ] as const,
            returnType: "Int",
            mutation: true,
        },
    } as const;

    authType = "User" as const;
    plugins = {};
}

export const schema = new SchemaType();
