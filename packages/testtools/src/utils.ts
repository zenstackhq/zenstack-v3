import { loadDocument } from '@zenstackhq/language';
import path from 'node:path';

export function loadDocumentWithPlugins(filePath: string) {
    const pluginModelFiles = [path.resolve(__dirname, '../node_modules/@zenstackhq/plugin-policy/plugin.zmodel')];
    return loadDocument(filePath, pluginModelFiles);
}
