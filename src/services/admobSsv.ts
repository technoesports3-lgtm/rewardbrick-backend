import axios from 'axios';
import { createPublicKey, verify } from 'crypto';

const ADMOB_VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const KEY_CACHE_MS = 24 * 60 * 60 * 1000;

type AdMobVerifierKey = {
    keyId: number;
    pem: string;
};

type AdMobVerifierKeyResponse = {
    keys?: AdMobVerifierKey[];
};

let cachedKeys: Map<number, string> = new Map();
let keysExpireAt = 0;

export class AdMobSsvVerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AdMobSsvVerificationError';
    }
}

const loadVerifierKeys = async (forceRefresh = false): Promise<Map<number, string>> => {
    if (!forceRefresh && cachedKeys.size > 0 && Date.now() < keysExpireAt) {
        return cachedKeys;
    }

    const response = await axios.get<AdMobVerifierKeyResponse>(ADMOB_VERIFIER_KEYS_URL, {
        timeout: 8000,
    });
    const keys = new Map<number, string>();
    for (const key of response.data.keys ?? []) {
        if (Number.isSafeInteger(key.keyId) && typeof key.pem === 'string') {
            keys.set(key.keyId, key.pem);
        }
    }
    if (keys.size === 0) {
        throw new Error('AdMob returned no SSV verifier keys.');
    }

    cachedKeys = keys;
    keysExpireAt = Date.now() + KEY_CACHE_MS;
    return cachedKeys;
};

export const verifyAdMobSsvCallback = async (
    originalUrl: string
): Promise<URLSearchParams> => {
    const queryStart = originalUrl.indexOf('?');
    if (queryStart < 0) {
        throw new AdMobSsvVerificationError('Missing callback query.');
    }

    const rawQuery = originalUrl.slice(queryStart + 1);
    const rawParameters = rawQuery.split('&');
    const signatureIndex = rawParameters.length - 2;
    const signatureParameter = rawParameters[signatureIndex];
    const keyIdParameter = rawParameters[signatureIndex + 1];
    if (!signatureParameter?.startsWith('signature=') ||
        !keyIdParameter?.startsWith('key_id=')) {
        throw new AdMobSsvVerificationError('Missing AdMob signature parameters.');
    }

    const signature = new URLSearchParams(signatureParameter).get('signature');
    const keyIdValue = new URLSearchParams(keyIdParameter).get('key_id');
    const keyId = Number(keyIdValue);
    if (!signature || !Number.isSafeInteger(keyId)) {
        throw new AdMobSsvVerificationError('Invalid AdMob signature parameters.');
    }

    let pem = (await loadVerifierKeys()).get(keyId);
    if (!pem) {
        pem = (await loadVerifierKeys(true)).get(keyId);
    }
    if (!pem) {
        throw new AdMobSsvVerificationError('Unknown AdMob signing key.');
    }

    const signedQuery = rawParameters.slice(0, signatureIndex).join('&');
    const isValid = verify(
        'sha256',
        Buffer.from(signedQuery, 'utf8'),
        createPublicKey(pem),
        Buffer.from(signature, 'base64url')
    );
    if (!isValid) {
        throw new AdMobSsvVerificationError('Invalid AdMob callback signature.');
    }

    return new URLSearchParams(rawQuery);
};
