import type { Model } from '@zenstackhq/language/ast';
import type { MaybePromise } from 'langium';

/**
 * Context passed to CLI plugins when calling `generate`.
 */
export type CliGeneratorContext = {
    /**
     * ZModel file path.
     */
    schemaFile: string;

    /**
     * ZModel AST.
     */
    model: Model;

    /**
     * Default output path for code generation.
     */
    defaultOutputPath: string;

    /**
     * Plugin options provided by the user.
     */
    pluginOptions: Record<string, unknown>;
};

/**
 * Contract for a CLI plugin.
 */
export interface CliPlugin {
    /**
     * Plugin's display name.
     */
    name: string;

    /**
     * Text to show during generation.
     */
    statusText?: string;

    /**
     * Code generation callback.
     */
    generate(context: CliGeneratorContext): MaybePromise<void>;
}
