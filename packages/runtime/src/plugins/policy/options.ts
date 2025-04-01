import type { ModelResult } from '../../client';
import type { GetModels, SchemaDef } from '../../schema';

export type Auth<Schema extends SchemaDef> = Schema['plugins'] extends {
    policy: object;
}
    ? Schema['plugins']['policy'] extends { authModel: infer AuthModel }
        ? AuthModel extends GetModels<Schema>
            ? Partial<ModelResult<Schema, AuthModel>>
            : never
        : never
    : never;

export type PolicyOptions<Schema extends SchemaDef> = {
    auth?: Auth<Schema>;
};
