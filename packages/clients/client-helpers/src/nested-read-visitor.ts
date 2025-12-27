import type { FieldDef, SchemaDef } from '@zenstackhq/schema';

/**
 * Callback functions for nested read visitor.
 */
export type NestedReadVisitorCallback = {
    /**
     * Callback for each field visited.
     * @returns If returns false, traversal will not continue into this field.
     */
    field?: (
        model: string,
        field: FieldDef | undefined,
        kind: 'include' | 'select' | undefined,
        args: unknown,
    ) => void | boolean;
};

/**
 * Visitor for nested read payload.
 */
export class NestedReadVisitor {
    constructor(
        private readonly schema: SchemaDef,
        private readonly callback: NestedReadVisitorCallback,
    ) {}

    private doVisit(model: string, field: FieldDef | undefined, kind: 'include' | 'select' | undefined, args: unknown) {
        if (this.callback.field) {
            const r = this.callback.field(model, field, kind, args);
            if (r === false) {
                return;
            }
        }

        if (!args || typeof args !== 'object') {
            return;
        }

        let selectInclude: any;
        let nextKind: 'select' | 'include' | undefined;
        if ((args as any).select) {
            selectInclude = (args as any).select;
            nextKind = 'select';
        } else if ((args as any).include) {
            selectInclude = (args as any).include;
            nextKind = 'include';
        }

        if (selectInclude && typeof selectInclude === 'object') {
            for (const [k, v] of Object.entries(selectInclude)) {
                if (k === '_count' && typeof v === 'object' && v) {
                    // recurse into { _count: { ... } }
                    this.doVisit(model, field, kind, v);
                } else {
                    const field = this.schema.models[model]?.fields[k];
                    if (field) {
                        this.doVisit(field.type, field, nextKind, v);
                    }
                }
            }
        }
    }

    visit(model: string, args: unknown) {
        this.doVisit(model, undefined, undefined, args);
    }
}
