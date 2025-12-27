import { db } from "$lib/db";
import { RPCApiHandler } from "@zenstackhq/server/api";
import { SvelteKitRouteHandler } from "@zenstackhq/server/sveltekit";
import { schema } from "../../../../zenstack/schema";

const handler = SvelteKitRouteHandler({
  apiHandler: new RPCApiHandler({ schema }),
  getClient: () => db,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
