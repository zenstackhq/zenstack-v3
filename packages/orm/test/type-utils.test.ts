import { describe, expectTypeOf, it } from 'vitest';
import type {
    ExtractIdFormat,
    FormatToTemplateLiteral,
    MapStringWithFormat,
} from '../src/utils/type-utils';
import type { CreateInput } from '../src/client/crud-types';
import type { SchemaDef } from '../src/schema';

describe('FormatToTemplateLiteral', () => {
    it('converts simple prefix format to template literal', () => {
        expectTypeOf<FormatToTemplateLiteral<'user_%s'>>().toEqualTypeOf<`user_${string}`>();
    });

    it('converts simple suffix format to template literal', () => {
        expectTypeOf<FormatToTemplateLiteral<'%s_suffix'>>().toEqualTypeOf<`${string}_suffix`>();
    });

    it('converts multiple placeholders to template literal', () => {
        expectTypeOf<FormatToTemplateLiteral<'pre_%s_mid_%s'>>().toEqualTypeOf<`pre_${string}_mid_${string}`>();
    });

    it('preserves string without placeholders', () => {
        expectTypeOf<FormatToTemplateLiteral<'no_placeholder'>>().toEqualTypeOf<'no_placeholder'>();
    });

    it('handles escaped \\%s as literal %s', () => {
        expectTypeOf<FormatToTemplateLiteral<'\\%s_end'>>().toEqualTypeOf<'%s_end'>();
    });

    it('handles mixed escaped and unescaped - unescaped first', () => {
        expectTypeOf<FormatToTemplateLiteral<'%s_\\%s'>>().toEqualTypeOf<`${string}_%s`>();
    });

    it('handles mixed escaped and unescaped - escaped first', () => {
        expectTypeOf<FormatToTemplateLiteral<'\\%s_%s'>>().toEqualTypeOf<`%s_${string}`>();
    });

    it('handles multiple escaped placeholders', () => {
        expectTypeOf<FormatToTemplateLiteral<'\\%s_\\%s'>>().toEqualTypeOf<'%s_%s'>();
    });

    it('handles complex mixed pattern', () => {
        expectTypeOf<FormatToTemplateLiteral<'pre_\\%s_%s_\\%s_end'>>().toEqualTypeOf<`pre_%s_${string}_%s_end`>();
    });
});

describe('ExtractIdFormat', () => {
    it('extracts format from uuid call with format arg', () => {
        type UuidCall = {
            kind: 'call';
            function: 'uuid';
            args: readonly [{ kind: 'literal'; value: 4 }, { kind: 'literal'; value: 'user_%s' }];
        };
        expectTypeOf<ExtractIdFormat<UuidCall>>().toEqualTypeOf<'user_%s'>();
    });

    it('extracts format from cuid call with format arg', () => {
        type CuidCall = {
            kind: 'call';
            function: 'cuid';
            args: readonly [{ kind: 'literal'; value: 2 }, { kind: 'literal'; value: 'post_%s' }];
        };
        expectTypeOf<ExtractIdFormat<CuidCall>>().toEqualTypeOf<'post_%s'>();
    });

    it('extracts format from nanoid call with format arg', () => {
        type NanoidCall = {
            kind: 'call';
            function: 'nanoid';
            args: readonly [{ kind: 'literal'; value: 21 }, { kind: 'literal'; value: 'nano_%s' }];
        };
        expectTypeOf<ExtractIdFormat<NanoidCall>>().toEqualTypeOf<'nano_%s'>();
    });

    it('extracts format from ulid call (format is first arg)', () => {
        type UlidCall = {
            kind: 'call';
            function: 'ulid';
            args: readonly [{ kind: 'literal'; value: 'ulid_%s' }];
        };
        expectTypeOf<ExtractIdFormat<UlidCall>>().toEqualTypeOf<'ulid_%s'>();
    });

    it('returns never for uuid call without format arg', () => {
        type UuidNoFormat = {
            kind: 'call';
            function: 'uuid';
            args: readonly [{ kind: 'literal'; value: 4 }];
        };
        expectTypeOf<ExtractIdFormat<UuidNoFormat>>().toEqualTypeOf<never>();
    });

    it('returns never for non-id-generator call', () => {
        type OtherCall = {
            kind: 'call';
            function: 'now';
            args: readonly [];
        };
        expectTypeOf<ExtractIdFormat<OtherCall>>().toEqualTypeOf<never>();
    });

    it('returns never for undefined', () => {
        expectTypeOf<ExtractIdFormat<undefined>>().toEqualTypeOf<never>();
    });
});

describe('MapStringWithFormat', () => {
    it('returns template literal for uuid with format', () => {
        type UuidCall = {
            kind: 'call';
            function: 'uuid';
            args: readonly [{ kind: 'literal'; value: 4 }, { kind: 'literal'; value: 'user_%s' }];
        };
        expectTypeOf<MapStringWithFormat<UuidCall>>().toEqualTypeOf<`user_${string}`>();
    });

    it('returns plain string for uuid without format', () => {
        type UuidNoFormat = {
            kind: 'call';
            function: 'uuid';
            args: readonly [{ kind: 'literal'; value: 4 }];
        };
        expectTypeOf<MapStringWithFormat<UuidNoFormat>>().toEqualTypeOf<string>();
    });

    it('returns plain string for undefined default', () => {
        expectTypeOf<MapStringWithFormat<undefined>>().toEqualTypeOf<string>();
    });

    it('returns plain string for non-call default', () => {
        expectTypeOf<MapStringWithFormat<'static-value'>>().toEqualTypeOf<string>();
    });

    it('handles escaped format in uuid call', () => {
        type UuidEscaped = {
            kind: 'call';
            function: 'uuid';
            args: readonly [{ kind: 'literal'; value: 4 }, { kind: 'literal'; value: '\\%s_%s' }];
        };
        expectTypeOf<MapStringWithFormat<UuidEscaped>>().toEqualTypeOf<`%s_${string}`>();
    });
});

describe('CreateInput with prefixed ID', () => {
    // Mock schema with a User model that has a prefixed ID
    type TestSchema = SchemaDef & {
        provider: { type: 'sqlite' };
        models: {
            User: {
                name: 'User';
                fields: {
                    id: {
                        name: 'id';
                        type: 'String';
                        id: true;
                        default: {
                            kind: 'call';
                            function: 'uuid';
                            args: readonly [
                                { kind: 'literal'; value: 4 },
                                { kind: 'literal'; value: 'user_%s' },
                            ];
                        };
                    };
                    name: {
                        name: 'name';
                        type: 'String';
                    };
                };
                uniqueFields: { id: { type: 'String' } };
                idFields: readonly ['id'];
            };
        };
        enums: {};
        plugins: {};
    };

    it('enforces template literal type for prefixed ID in create input', () => {
        type UserCreateInput = CreateInput<TestSchema, 'User'>;

        // The id field should accept template literal type
        expectTypeOf<UserCreateInput['id']>().toEqualTypeOf<`user_${string}` | undefined>();
    });

    it('allows plain string for non-prefixed ID fields', () => {
        // Schema with plain uuid (no format)
        type PlainIdSchema = SchemaDef & {
            provider: { type: 'sqlite' };
            models: {
                Post: {
                    name: 'Post';
                    fields: {
                        id: {
                            name: 'id';
                            type: 'String';
                            id: true;
                            default: {
                                kind: 'call';
                                function: 'uuid';
                                args: readonly [{ kind: 'literal'; value: 4 }];
                            };
                        };
                        title: {
                            name: 'title';
                            type: 'String';
                        };
                    };
                    uniqueFields: { id: { type: 'String' } };
                    idFields: readonly ['id'];
                };
            };
            enums: {};
            plugins: {};
        };

        type PostCreateInput = CreateInput<PlainIdSchema, 'Post'>;

        // The id field should accept plain string
        expectTypeOf<PostCreateInput['id']>().toEqualTypeOf<string | undefined>();
    });

    it('enforces template literal for cuid with format', () => {
        type CuidSchema = SchemaDef & {
            provider: { type: 'sqlite' };
            models: {
                Comment: {
                    name: 'Comment';
                    fields: {
                        id: {
                            name: 'id';
                            type: 'String';
                            id: true;
                            default: {
                                kind: 'call';
                                function: 'cuid';
                                args: readonly [
                                    { kind: 'literal'; value: 2 },
                                    { kind: 'literal'; value: 'cmt_%s' },
                                ];
                            };
                        };
                    };
                    uniqueFields: { id: { type: 'String' } };
                    idFields: readonly ['id'];
                };
            };
            enums: {};
            plugins: {};
        };

        type CommentCreateInput = CreateInput<CuidSchema, 'Comment'>;
        expectTypeOf<CommentCreateInput['id']>().toEqualTypeOf<`cmt_${string}` | undefined>();
    });

    it('enforces template literal for ulid with format (format is first arg)', () => {
        type UlidSchema = SchemaDef & {
            provider: { type: 'sqlite' };
            models: {
                Order: {
                    name: 'Order';
                    fields: {
                        id: {
                            name: 'id';
                            type: 'String';
                            id: true;
                            default: {
                                kind: 'call';
                                function: 'ulid';
                                args: readonly [{ kind: 'literal'; value: 'ord_%s' }];
                            };
                        };
                    };
                    uniqueFields: { id: { type: 'String' } };
                    idFields: readonly ['id'];
                };
            };
            enums: {};
            plugins: {};
        };

        type OrderCreateInput = CreateInput<UlidSchema, 'Order'>;
        expectTypeOf<OrderCreateInput['id']>().toEqualTypeOf<`ord_${string}` | undefined>();
    });
});
