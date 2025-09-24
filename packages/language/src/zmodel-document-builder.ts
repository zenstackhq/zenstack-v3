import { DefaultDocumentBuilder, type BuildOptions, type LangiumDocument } from 'langium';

export class ZModelDocumentBuilder extends DefaultDocumentBuilder {
    override buildDocuments(documents: LangiumDocument[], options: BuildOptions, cancelToken: any): Promise<void> {
        return super.buildDocuments(
            documents,
            {
                ...options,
                validation:
                    // force overriding validation options
                    options.validation === false || options.validation === undefined
                        ? options.validation
                        : {
                              stopAfterLexingErrors: true,
                              stopAfterParsingErrors: true,
                              stopAfterLinkingErrors: true,
                          },
            },
            cancelToken,
        );
    }
}
