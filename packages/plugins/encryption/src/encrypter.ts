import { _encrypt, ENCRYPTION_KEY_BYTES, getKeyDigest, loadKey } from './utils.js';

/**
 * Default encrypter using AES-256-GCM
 */
export class Encrypter {
    private key: CryptoKey | undefined;
    private keyDigest: string | undefined;

    constructor(private readonly encryptionKey: Uint8Array) {
        if (encryptionKey.length !== ENCRYPTION_KEY_BYTES) {
            throw new Error(`Encryption key must be ${ENCRYPTION_KEY_BYTES} bytes`);
        }
    }

    /**
     * Encrypts the given data
     */
    async encrypt(data: string): Promise<string> {
        if (!this.key) {
            this.key = await loadKey(this.encryptionKey, ['encrypt']);
        }

        if (!this.keyDigest) {
            this.keyDigest = await getKeyDigest(this.encryptionKey);
        }

        return _encrypt(data, this.key, this.keyDigest);
    }
}
