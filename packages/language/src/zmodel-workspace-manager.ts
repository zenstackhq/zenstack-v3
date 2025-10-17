import {
    DefaultWorkspaceManager,
    URI,
    type AstNode,
    type LangiumDocument,
    type LangiumDocumentFactory,
    type WorkspaceFolder,
} from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STD_LIB_MODULE_NAME } from './constants';

export class ZModelWorkspaceManager extends DefaultWorkspaceManager {
    private documentFactory: LangiumDocumentFactory;

    constructor(services: LangiumSharedServices) {
        super(services);
        this.documentFactory = services.workspace.LangiumDocumentFactory;
    }

    protected override async loadAdditionalDocuments(
        folders: WorkspaceFolder[],
        collector: (document: LangiumDocument<AstNode>) => void,
    ): Promise<void> {
        await super.loadAdditionalDocuments(folders, collector);

        // load stdlib.zmodel
        let stdLibPath: string;

        // First, try to find the stdlib from an installed zenstack package
        // in the project's node_modules
        let installedStdlibPath: string | undefined;
        for (const folder of folders) {
            const folderPath = this.getRootFolder(folder).fsPath;
            try {
                // Try to resolve zenstack from the workspace folder
                const languagePackagePath = require.resolve('@zenstackhq/language/package.json', {
                    paths: [folderPath],
                });
                const languagePackageDir = path.dirname(languagePackagePath);
                const candidateStdlibPath = path.join(languagePackageDir, 'res', STD_LIB_MODULE_NAME);

                // Check if the stdlib file exists in the installed package
                if (fs.existsSync(candidateStdlibPath)) {
                    installedStdlibPath = candidateStdlibPath;
                    console.log(`Found installed zenstack package stdlib at: ${installedStdlibPath}`);
                    break;
                }
            } catch {
                // Package not found or other error, continue to next folder
                continue;
            }
        }

        if (installedStdlibPath) {
            stdLibPath = installedStdlibPath;
        } else {
            // Fallback to bundled stdlib
            // isomorphic __dirname
            const _dirname =
                typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

            stdLibPath = path.join(_dirname, '../res', STD_LIB_MODULE_NAME);
            console.log(`Using bundled stdlib in extension:`, stdLibPath);
        }

        const stdlib = await this.documentFactory.fromUri(URI.file(stdLibPath));
        collector(stdlib);
    }
}
