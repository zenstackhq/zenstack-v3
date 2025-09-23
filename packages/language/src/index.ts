import { isAstNode, URI, type LangiumDocument, type LangiumDocuments, type Mutable } from 'langium';
import { NodeFileSystem } from 'langium/node';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDataSource, type AstNode, type Model } from './ast';
import { STD_LIB_MODULE_NAME } from './constants';
import { createZModelLanguageServices, type ZModelServices } from './module';
import { getDataModelAndTypeDefs, getDocument, hasAttribute, resolveImport, resolveTransitiveImports } from './utils';

export function createZModelServices() {
    return createZModelLanguageServices(NodeFileSystem);
}

export class DocumentLoadError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export async function loadDocument(
    fileName: string,
    pluginModelFiles: string[] = [],
): Promise<
    { success: true; model: Model; warnings: string[], services: ZModelServices } | { success: false; errors: string[]; warnings: string[] }
> {
    const { ZModelLanguage: services } = createZModelServices();
    const extensions = services.LanguageMetaData.fileExtensions;
    if (!extensions.includes(path.extname(fileName))) {
        return {
            success: false,
            errors: ['invalid schema file extension'],
            warnings: [],
        };
    }

    if (!fs.existsSync(fileName)) {
        return {
            success: false,
            errors: ['schema file does not exist'],
            warnings: [],
        };
    }

    // load standard library

    // isomorphic __dirname
    const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    const stdLib = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
        URI.file(path.resolve(path.join(_dirname, '../res', STD_LIB_MODULE_NAME))),
    );

    // load plugin model files
    const pluginDocs = await Promise.all(
        pluginModelFiles.map((file) =>
            services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(path.resolve(file))),
        ),
    );

    // load the document
    const langiumDocuments = services.shared.workspace.LangiumDocuments;
    const document = await langiumDocuments.getOrCreateDocument(URI.file(path.resolve(fileName)));

    // load imports
    const importedURIs = await loadImports(document, langiumDocuments);
    const importedDocuments: LangiumDocument[] = [];
    for (const uri of importedURIs) {
        importedDocuments.push(await langiumDocuments.getOrCreateDocument(uri));
    }

    // build the document together with standard library, plugin modules, and imported documents
    await services.shared.workspace.DocumentBuilder.build([stdLib, ...pluginDocs, document, ...importedDocuments], {
        validation: {
            stopAfterLexingErrors: true,
            stopAfterParsingErrors: true,
            stopAfterLinkingErrors: true,
        },
    });

    const diagnostics = langiumDocuments.all
        .flatMap((doc) => (doc.diagnostics ?? []).map((diag) => ({ doc, diag })))
        .filter(({ diag }) => diag.severity === 1 || diag.severity === 2)
        .toArray();

    const errors: string[] = [];
    const warnings: string[] = [];

    if (diagnostics.length > 0) {
        for (const { doc, diag } of diagnostics) {
            const message = `${path.relative(process.cwd(), doc.uri.fsPath)}:${
                diag.range.start.line + 1
            }:${diag.range.start.character + 1} - ${diag.message}`;

            if (diag.severity === 1) {
                errors.push(message);
            } else {
                warnings.push(message);
            }
        }
    }

    if (errors.length > 0) {
        return {
            success: false,
            errors,
            warnings,
        };
    }

    const model = document.parseResult.value as Model;

    // merge all declarations into the main document
    const imported = mergeImportsDeclarations(langiumDocuments, model);

    // remove imported documents
    imported.forEach((model) => {
        langiumDocuments.deleteDocument(model.$document!.uri);
        services.shared.workspace.IndexManager.remove(model.$document!.uri);
    });

    // extra validation after merging imported declarations
    const additionalErrors = validationAfterImportMerge(model);
    if (additionalErrors.length > 0) {
        return {
            success: false,
            errors: additionalErrors,
            warnings,
        };
    }

    return {
        success: true,
        model: document.parseResult.value as Model,
        services,
        warnings,
    };
}

async function loadImports(document: LangiumDocument, documents: LangiumDocuments, uris: Set<string> = new Set()) {
    const uriString = document.uri.toString();
    if (!uris.has(uriString)) {
        uris.add(uriString);
        const model = document.parseResult.value as Model;
        for (const imp of model.imports) {
            const importedModel = resolveImport(documents, imp);
            if (importedModel) {
                const importedDoc = getDocument(importedModel);
                await loadImports(importedDoc, documents, uris);
            }
        }
    }
    return Array.from(uris)
        .filter((x) => uriString != x)
        .map((e) => URI.parse(e));
}

function mergeImportsDeclarations(documents: LangiumDocuments, model: Model) {
    const importedModels = resolveTransitiveImports(documents, model);

    const importedDeclarations = importedModels.flatMap((m) => m.declarations);
    model.declarations.push(...importedDeclarations);

    // remove import directives
    model.imports = [];

    // fix $container, $containerIndex, and $containerProperty
    linkContentToContainer(model);

    return importedModels;
}

function linkContentToContainer(node: AstNode): void {
    for (const [name, value] of Object.entries(node)) {
        if (!name.startsWith('$')) {
            if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (isAstNode(item)) {
                        (item as Mutable<AstNode>).$container = node;
                        (item as Mutable<AstNode>).$containerProperty = name;
                        (item as Mutable<AstNode>).$containerIndex = index;
                    }
                });
            } else if (isAstNode(value)) {
                (value as Mutable<AstNode>).$container = node;
                (value as Mutable<AstNode>).$containerProperty = name;
            }
        }
    }
}

function validationAfterImportMerge(model: Model) {
    const errors: string[] = [];
    const dataSources = model.declarations.filter((d) => isDataSource(d));
    if (dataSources.length === 0) {
        errors.push('Validation error: schema must have a datasource declaration');
    } else {
        if (dataSources.length > 1) {
            errors.push('Validation error: multiple datasource declarations are not allowed');
        }
    }

    // at most one `@@auth` model
    const decls = getDataModelAndTypeDefs(model, true);
    const authDecls = decls.filter((d) => hasAttribute(d, '@@auth'));
    if (authDecls.length > 1) {
        errors.push('Validation error: Multiple `@@auth` declarations are not allowed');
    }
    return errors;
}

export * from './module';
