import { encodeHashToBase64, decodeHashFromBase64 } from '@holochain/client';

/**
 * Common utilities for Holochain zome operations
 */

// Hash encoding/decoding utilities
export function encodeHash(hash: Uint8Array): string {
    return encodeHashToBase64(hash);
}

export function decodeHash(hashB64: string): Uint8Array {
    return decodeHashFromBase64(hashB64);
}

// Standardize hash format to base64
export function standardizeHashFormat(groupHash: string): string {
    if (typeof groupHash === 'string' && groupHash.includes(',')) {
        console.log("Converting comma-separated hash to base64");
        const byteArray = new Uint8Array(groupHash.split(',').map(Number));
        return encodeHashToBase64(byteArray);
    }
    return groupHash;
}

// Standard zome call wrapper
export async function callZome(client: any, roleName: string, zomeName: string, fnName: string, payload: any) {
    if (!client) {
        throw new Error('Holochain client not available');
    }
    
    return await client.callZome({
        role_name: roleName,
        zome_name: zomeName,
        fn_name: fnName,
        payload
    });
}