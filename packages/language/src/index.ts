import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Model } from './ast';
import { STD_LIB_MODULE_NAME } from './constants';
import { createZModelLanguageServices } from './module';

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
    pluginModelFiles: string[] = []
): Promise<
    | { success: true; model: Model; warnings: string[] }
    | { success: false; errors: string[]; warnings: string[] }
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
    const stdLib =
        await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
            URI.file(
                path.resolve(
                    path.join(
                        path.dirname(fileURLToPath(import.meta.url)),
                        './res',
                        STD_LIB_MODULE_NAME
                    )
                )
            )
        );

    // load plugin model files
    const pluginDocs = await Promise.all(
        pluginModelFiles.map((file) =>
            services.shared.workspace.LangiumDocuments.getOrCreateDocument(
                URI.file(path.resolve(file))
            )
        )
    );

    // load the document
    const langiumDocuments = services.shared.workspace.LangiumDocuments;
    const document = await langiumDocuments.getOrCreateDocument(
        URI.file(path.resolve(fileName))
    );

    // build the document together with standard library, plugin modules, and imported documents
    await services.shared.workspace.DocumentBuilder.build(
        [stdLib, ...pluginDocs, document],
        {
            validation: true,
        }
    );

    const diagnostics = langiumDocuments.all
        .flatMap((doc) =>
            (doc.diagnostics ?? []).map((diag) => ({ doc, diag }))
        )
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

    return {
        success: true,
        model: document.parseResult.value as Model,
        warnings,
    };
}

export * from './module';
