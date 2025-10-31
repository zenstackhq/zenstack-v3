import type { GetModels, SchemaDef } from '.';
import type { ModelResult } from '../client/crud-types';

export type AuthType<Schema extends SchemaDef> =
    string extends GetModels<Schema>
        ? Record<string, unknown>
        : Schema['authType'] extends GetModels<Schema>
          ? Partial<ModelResult<Schema, Schema['authType']>>
          : never;
