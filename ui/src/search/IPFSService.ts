/**
 * Service for IPFS operations using Pinata
 * Handles upload and download of IndexedDB blobs
 */
export class IPFSService {
    private pinataJWT: string;
    private pinataGateway: string;

    constructor() {
        this.pinataJWT = import.meta.env.VITE_PINATA_JWT;
        this.pinataGateway = import.meta.env.VITE_PINATA_GATEWAY;

        if (!this.pinataJWT || !this.pinataGateway) {
            throw new Error('Missing Pinata configuration. Check VITE_PINATA_JWT and VITE_PINATA_GATEWAY in .env');
        }
    }

    /**
     * Upload IndexedDB blob to IPFS via Pinata (using modern v3 API)
     */
    async uploadIndexedDBBlob(blob: Blob, metadata?: { productCount: number, version: string }): Promise<string> {
        try {
            
            // Create a unique filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `search-index-${timestamp}.db`;
            
            // Create File object from Blob (required by modern Pinata API)
            const file = new File([blob], filename, { type: 'application/octet-stream' });
            
            // Use v3 files endpoint with public network specification
            const formData = new FormData();
            formData.append('file', file);
            formData.append('name', filename);
            formData.append('network', 'public'); // This makes the upload publicly accessible
            
            // Add metadata as keyvalues for v3 API
            if (metadata) {
                formData.append('keyvalues', JSON.stringify({
                    type: 'search-index',
                    created: timestamp,
                    productCount: metadata.productCount.toString(),
                    version: metadata.version
                }));
            }

            const response = await fetch('https://uploads.pinata.cloud/v3/files', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.pinataJWT}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Pinata upload failed: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            
            // The v3 API response format uses data.cid field
            const cid = result.data?.cid;
            
            if (!cid) {
                console.error('[IPFSService] No CID found in response:', result);
                throw new Error('No CID returned from Pinata upload');
            }
            
            console.log(`[IPFSService] Successfully uploaded to IPFS. CID: ${cid}`);
            return cid;

        } catch (error) {
            console.error('[IPFSService] Error uploading to IPFS:', error);
            throw error;
        }
    }

    /**
     * Download IndexedDB blob from IPFS via Pinata gateway (Agent 2+ function)
     */
    async downloadIndexedDBBlob(cid: string): Promise<Blob> {
        try {
            
            // Use the same dedicated gateway for downloads as uploads
            const downloadUrl = `https://${this.pinataGateway}/ipfs/${cid}`;
            
            
            const response = await fetch(downloadUrl, {
                method: 'GET',
                headers: {
                    // For public IPFS files, no authorization needed
                    'Accept': 'application/octet-stream, */*'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[IPFSService] Download failed. Status: ${response.status}, Response: ${errorText}`);
                throw new Error(`Failed to download from IPFS: ${response.status} ${response.statusText}. Response: ${errorText}`);
            }

            // Check if we got HTML instead of binary data
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('text/html')) {
                const htmlContent = await response.text();
                console.error(`[IPFSService] Received HTML instead of binary data. Content: ${htmlContent.substring(0, 500)}...`);
                throw new Error('Received HTML response instead of binary data from IPFS gateway');
            }

            const blob = await response.blob();
            console.log(`[IPFSService] Successfully downloaded blob: ${blob.size} bytes, type: ${blob.type}`);
            
            return blob;

        } catch (error) {
            console.error('[IPFSService] Error downloading from IPFS:', error);
            throw error;
        }
    }

    /**
     * Get latest search index CID from Holochain DHT
     */
    async getLatestSearchIndexCID(client: any): Promise<string | null> {
        try {
            console.log('[IPFSService] Fetching latest search index CID from DHT...');
            
            const latestIndex = await client.callZome({
                role_name: "search_index",
                zome_name: "search_index", 
                fn_name: "get_latest_search_index",
                payload: null
            });

            if (!latestIndex) {
                console.log('[IPFSService] No search index found in DHT');
                return null;
            }

            const cid = latestIndex.ipfs_cid;
            
            console.log(`[IPFSService] Latest search index CID: ${cid} (${latestIndex.product_count} products)`);
            return cid;

        } catch (error) {
            console.error('[IPFSService] Error fetching search index CID from DHT:', error);
            throw error;
        }
    }

    /**
     * Test IPFS connectivity and JWT token scopes
     */
    async testConnection(): Promise<{ connected: boolean, scopes?: string[], error?: string }> {
        try {
            console.log('[IPFSService] Testing Pinata connection and JWT scopes...');
            
            const response = await fetch('https://api.pinata.cloud/data/testAuthentication', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.pinataJWT}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                console.log('[IPFSService] Connection test successful:', result);
                return { 
                    connected: true, 
                    scopes: result.scopes || []
                };
            } else {
                const errorText = await response.text();
                console.error('[IPFSService] Connection test failed:', response.status, errorText);
                return { 
                    connected: false, 
                    error: `${response.status}: ${errorText}` 
                };
            }
        } catch (error) {
            console.error('[IPFSService] Connection test failed:', error);
            return { 
                connected: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }
}

// Singleton instance
export const ipfsService = new IPFSService();