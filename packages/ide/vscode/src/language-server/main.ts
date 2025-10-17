import { createZModelLanguageServices } from '@zenstackhq/language';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared } = createZModelLanguageServices(
    {
        connection,
        ...NodeFileSystem,
    },
    true,
);

// Start the language server with the shared services
startLanguageServer(shared);
