import { ZenStackClient } from "@zenstackhq/orm";
import SQLite from "better-sqlite3";
import { SqliteDialect } from "kysely";
import { schema } from "../zenstack/schema";

export const db = new ZenStackClient(schema, {
  dialect: new SqliteDialect({
    database: new SQLite("./src/zenstack/dev.db"),
  }),
  procedures: {
    signUp: ({ client, args }) =>
      client.user.create({
        data: { ...args },
      }),
    listPublicPosts: ({ client }) =>
      client.post.findMany({
        where: {
          published: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
  },
});
