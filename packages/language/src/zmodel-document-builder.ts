import { DefaultDocumentBuilder, type LangiumSharedCoreServices } from 'langium';

export class ZModelDocumentBuilder extends DefaultDocumentBuilder {
    constructor(services: LangiumSharedCoreServices) {
        super(services);

        // override update build options to skip validation when there are
        // errors in the previous stages
        let validationOptions = this.updateBuildOptions.validation;
        const stopFlags = {
            stopAfterLinkingErrors: true,
            stopAfterLexingErrors: true,
            stopAfterParsingErrors: true,
        };
        if (validationOptions === true) {
            validationOptions = stopFlags;
        } else if (typeof validationOptions === 'object') {
            validationOptions = { ...validationOptions, ...stopFlags };
        }

        this.updateBuildOptions = {
            ...this.updateBuildOptions,
            validation: validationOptions,
        };
    }
}
