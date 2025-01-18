import type { LangiumDocuments, ValidationAcceptor } from 'langium';
import { PLUGIN_MODULE_NAME, STD_LIB_MODULE_NAME } from '../constants';
import { isDataModel, isDataSource, type Model } from '../generated/ast';
import {
    getAllDeclarationsIncludingImports,
    getDataModelAndTypeDefs,
    hasAttribute,
    resolveImport,
    resolveTransitiveImports,
} from '../utils';
import { validateDuplicatedDeclarations, type AstValidator } from './common';

/**
 * Validates toplevel schema.
 */
export default class SchemaValidator implements AstValidator<Model> {
    constructor(protected readonly documents: LangiumDocuments) {}

    async validate(model: Model, accept: ValidationAcceptor) {
        await this.validateImports(model, accept);
        validateDuplicatedDeclarations(model, model.declarations, accept);

        const importedModels = await resolveTransitiveImports(
            this.documents,
            model
        );

        const importedNames = new Set(
            importedModels.flatMap((m) => m.declarations.map((d) => d.name))
        );

        for (const declaration of model.declarations) {
            if (importedNames.has(declaration.name)) {
                accept(
                    'error',
                    `A ${declaration.name} already exists in an imported module`,
                    {
                        node: declaration,
                        property: 'name',
                    }
                );
            }
        }

        if (
            !model.$document?.uri.path.endsWith(STD_LIB_MODULE_NAME) &&
            !model.$document?.uri.path.endsWith(PLUGIN_MODULE_NAME)
        ) {
            this.validateDataSources(model, accept);
        }

        // at most one `@@auth` model
        const decls = getDataModelAndTypeDefs(model, true);
        const authModels = decls.filter(
            (d) => isDataModel(d) && hasAttribute(d, '@@auth')
        );
        if (authModels.length > 1) {
            accept('error', 'Multiple `@@auth` models are not allowed', {
                node: authModels[1]!,
            });
        }
    }

    private async validateDataSources(
        model: Model,
        accept: ValidationAcceptor
    ) {
        const dataSources = (
            await getAllDeclarationsIncludingImports(this.documents, model)
        ).filter((d) => isDataSource(d));
        if (dataSources.length > 1) {
            accept(
                'error',
                'Multiple datasource declarations are not allowed',
                { node: dataSources[1]! }
            );
        }
    }

    private async validateImports(model: Model, accept: ValidationAcceptor) {
        await Promise.all(
            model.imports.map(async (imp) => {
                const importedModel = await resolveImport(this.documents, imp);
                const importPath = imp.path.endsWith('.zmodel')
                    ? imp.path
                    : `${imp.path}.zmodel`;
                if (!importedModel) {
                    accept('error', `Cannot find model file ${importPath}`, {
                        node: imp,
                    });
                }
            })
        );
    }
}
