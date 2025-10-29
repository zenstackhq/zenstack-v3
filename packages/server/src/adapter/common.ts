import type { SchemaDef } from "@zenstackhq/orm/schema";
import type { ApiHandler } from "../types";

/**
 * Options common to all adapters
 */
export interface CommonAdapterOptions<Schema extends SchemaDef> {
    /**
     * The API handler to process requests
     */
    apiHandler: ApiHandler<Schema>;
}