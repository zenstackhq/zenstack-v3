import { loadDocument } from '@zenstackhq/language';

export function loadDocumentWithPlugins(filePath: string) {
    const pluginModelFiles = [require.resolve('@zenstackhq/plugin-policy/plugin.zmodel')];
    return loadDocument(filePath, pluginModelFiles);
}
