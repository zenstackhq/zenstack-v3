import type { AstNode, MaybePromise, ValidationAcceptor } from 'langium';
import { isDataModelField } from '../generated/ast';

/**
 * AST validator contract
 */
export interface AstValidator<T extends AstNode> {
    /**
     * Validates an AST node
     */
    validate(node: T, accept: ValidationAcceptor): MaybePromise<void>;
}

/**
 * Checks if the given declarations have duplicated names
 */
export function validateDuplicatedDeclarations(
    container: AstNode,
    decls: Array<AstNode & { name: string }>,
    accept: ValidationAcceptor
): void {
    const groupByName = decls.reduce<
        Record<string, Array<AstNode & { name: string }>>
    >((group, decl) => {
        group[decl.name] = group[decl.name] ?? [];
        group[decl.name]!.push(decl);
        return group;
    }, {});

    for (const [name, decls] of Object.entries<AstNode[]>(groupByName)) {
        if (decls.length > 1) {
            let errorField = decls[1]!;
            if (isDataModelField(decls[0])) {
                const nonInheritedFields = decls.filter(
                    (x) => !(isDataModelField(x) && x.$container !== container)
                );
                if (nonInheritedFields.length > 0) {
                    errorField = nonInheritedFields.slice(-1)[0]!;
                }
            }

            accept('error', `Duplicated declaration name "${name}"`, {
                node: errorField,
            });
        }
    }
}
