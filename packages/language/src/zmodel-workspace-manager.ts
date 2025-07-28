import {
    DefaultWorkspaceManager,
    URI,
    UriUtils,
    type AstNode,
    type LangiumDocument,
    type LangiumDocumentFactory,
    type WorkspaceFolder,
} from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlugin, type Model } from './ast';
import { PLUGIN_MODULE_NAME, STD_LIB_MODULE_NAME } from './constants';
import { getLiteral } from './utils';

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

        const documents = this.langiumDocuments.all;
        const pluginModels = new Set<string>();

        // find plugin models
        documents.forEach((doc) => {
            const parsed = doc.parseResult.value as Model;
            parsed.declarations.forEach((decl) => {
                if (isPlugin(decl)) {
                    const providerField = decl.fields.find((f) => f.name === 'provider');
                    if (providerField) {
                        const provider = getLiteral<string>(providerField.value);
                        if (provider) {
                            pluginModels.add(provider);
                        }
                    }
                }
            });
        });

        if (pluginModels.size > 0) {
            console.log(`Used plugin modules: ${Array.from(pluginModels)}`);

            // the loaded plugin models would be removed from the set
            const pendingPluginModules = new Set(pluginModels);

            await Promise.all(
                folders
                    .map((wf) => [wf, this.getRootFolder(wf)] as [WorkspaceFolder, URI])
                    .map(async (entry) => this.loadPluginModels(...entry, pendingPluginModules, collector)),
            );
        }
    }

    protected async loadPluginModels(
        workspaceFolder: WorkspaceFolder,
        folderPath: URI,
        pendingPluginModels: Set<string>,
        collector: (document: LangiumDocument) => void,
    ): Promise<void> {
        const content = (await this.fileSystemProvider.readDirectory(folderPath)).sort((a, b) => {
            // make sure the node_modules folder is always the first one to be checked
            // so we can exit early if the plugin is found
            if (a.isDirectory && b.isDirectory) {
                const aName = UriUtils.basename(a.uri);
                if (aName === 'node_modules') {
                    return -1;
                } else {
                    return 1;
                }
            } else {
                return 0;
            }
        });

        for (const entry of content) {
            if (entry.isDirectory) {
                const name = UriUtils.basename(entry.uri);
                if (name === 'node_modules') {
                    for (const plugin of Array.from(pendingPluginModels)) {
                        const path = UriUtils.joinPath(entry.uri, plugin, PLUGIN_MODULE_NAME);
                        try {
                            await this.fileSystemProvider.readFile(path);
                            const document = await this.langiumDocuments.getOrCreateDocument(path);
                            collector(document);
                            console.log(`Adding plugin document from ${path.path}`);

                            pendingPluginModels.delete(plugin);
                            // early exit if all plugins are loaded
                            if (pendingPluginModels.size === 0) {
                                return;
                            }
                        } catch {
                            // no-op. The module might be found in another node_modules folder
                            // will show the warning message eventually if not found
                        }
                    }
                } else {
                    await this.loadPluginModels(workspaceFolder, entry.uri, pendingPluginModels, collector);
                }
            }
        }
    }
}
