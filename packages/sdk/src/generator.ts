import type { Model } from '@zenstackhq/language/ast';
import type { MaybePromise } from 'langium';

export type CliGeneratorContext = {
    model: Model;
    outputPath: string;
    tsSchemaFile: string;
};

export type CliGenerator = (context: CliGeneratorContext) => MaybePromise<void>;
