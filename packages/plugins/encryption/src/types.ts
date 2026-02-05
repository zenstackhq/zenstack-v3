import type { FieldDef } from '@zenstackhq/orm/schema';

/**
 * Simple encryption configuration using built-in AES-256-GCM encryption
 */
export type SimpleEncryption = {
    /**
     * The encryption key (must be 32 bytes / 256 bits)
     */
    encryptionKey: Uint8Array;

    /**
     * Additional decryption keys for key rotation support.
     * When decrypting, all keys (encryptionKey + decryptionKeys) are tried.
     */
    decryptionKeys?: Uint8Array[];
};

/**
 * Custom encryption configuration for user-provided encryption handlers
 */
export type CustomEncryption = {
    /**
     * Custom encryption function
     * @param model The model name
     * @param field The field definition
     * @param plain The plaintext value to encrypt
     * @returns The encrypted value
     */
    encrypt: (model: string, field: FieldDef, plain: string) => Promise<string>;

    /**
     * Custom decryption function
     * @param model The model name
     * @param field The field definition
     * @param cipher The encrypted value to decrypt
     * @returns The decrypted value
     */
    decrypt: (model: string, field: FieldDef, cipher: string) => Promise<string>;
};

/**
 * Encryption configuration - either simple (built-in) or custom
 */
export type EncryptionConfig = SimpleEncryption | CustomEncryption;

/**
 * Type guard to check if encryption config is custom
 */
export function isCustomEncryption(config: EncryptionConfig): config is CustomEncryption {
    return 'encrypt' in config && 'decrypt' in config;
}
