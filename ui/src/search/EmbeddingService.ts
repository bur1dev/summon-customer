import { nanoid } from 'nanoid';
import type { Product } from './search-types'; // Assuming Product is in search-types

// Types for messages between main thread and worker
export interface WorkerMessage {
    id: string;
    type: 'loadModel' | 'embedQuery' | 'rankSimilarity' | // Original types
    'initHnswLib' | 'initHnswIndex' | 'addPointsToHnsw' | 'searchHnsw' | // HNSW specific
    'loadHnswIndexFile' | 'saveHnswIndexFile' | 'switchHnswContext'; // HNSW file operations + new context switch
    [key: string]: any;
}

export interface WorkerResponse {
    id: string;
    type: string; // e.g., 'hnswInitResult', 'hnswSearchResult', 'hnswBuildProgress'
    success?: boolean;
    error?: string;
    data?: any; // Generic data payload
    [key: string]: any;
}

export interface EmbeddingServiceConfig {
    modelName?: string;
    workerUrl?: string;
    maxCacheSize?: number;
    hnswIndexFilename?: string; // For saving/loading HNSW index
}

export interface EmbeddingRequest {
    id: string;
    query: string;
    priority: number;
    timestamp: number;
    resolve: (result: Float32Array | null) => void;
    reject: (error: Error) => void;
}

/**
 * Service for managing embedding calculations and HNSW operations via Web Worker
 */
export class EmbeddingService {
    private worker: Worker | null = null;
    private isInitialized: boolean = false; // Tracks overall service initialization (worker ready, model loaded)
    private isLoading: boolean = false; // General loading state for the service
    private pendingRequests: Map<string, { resolve: Function, reject: Function, operation?: string }> = new Map();
    private embeddingQueue: EmbeddingRequest[] = [];
    private processingQueue: boolean = false;
    private embeddingCache: Map<string, { embedding: Float32Array, timestamp: number }> = new Map();

    private config: EmbeddingServiceConfig = {
        modelName: 'Xenova/all-mpnet-base-v2',
        workerUrl: '/embedding-worker.js', // Path to the worker script
        maxCacheSize: 100,
        hnswIndexFilename: 'hnsw_index_main.dat'
    };

    // --- HNSW state tracking (main thread perspective) ---
    private isHnswLibInitializedInWorker: boolean = false;
    private isHnswIndexReadyInWorker: boolean = false;
    private hnswIndexSourceProductsRef: Product[] | null = null; // To track active index in worker

    // New global index state tracking
    private isGlobalHnswIndexReadyInWorker: boolean = false; // Tracks if global index is ready
    private globalHnswIndexSourceProductsRef: Product[] | null = null; // Tracks global index product list

    // Track current worker context
    private currentWorkerIndexContext: 'global' | 'temporary' = 'global'; // Track which index the worker currently has active

    private readonly HNSW_DIMENSION = 768;
    private latestTemporaryOperationId: string | null = null;
    // --- End HNSW state tracking ---

    constructor(config?: EmbeddingServiceConfig) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized || this.isLoading) {
            // If already initializing or initialized, wait for existing promise or return
            // This part might need a dedicated initialization promise if multiple calls happen
            return;
        }
        this.isLoading = true;
        try {
            this.worker = new Worker(
                new URL('./embedding-worker.ts', import.meta.url), // Ensure this path is correct
                { type: 'module' }
            );
            this.worker.onmessage = this.handleWorkerMessage.bind(this);
            this.worker.onerror = (error) => {
                console.error('Embedding worker error:', error);
                this.cleanupWorker();
            };

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.pendingRequests.forEach(pr => pr.reject(new Error('Worker initialization timeout during initial setup')));
                    this.pendingRequests.clear();
                    reject(new Error('Worker initialization timeout'));
                }, 20000); // Increased timeout

                const tempId = nanoid(); // Use a temporary ID for this specific promise
                this.pendingRequests.set(tempId, {
                    resolve: () => { clearTimeout(timeout); resolve(); },
                    reject: (err: any) => { clearTimeout(timeout); reject(err); },
                    operation: 'workerReady'
                });
                // The worker will post { type: 'workerReady', id: 'worker-ready-signal' (or similar) }
                // We need a way to resolve this specific promise.
                // Let's modify handleWorkerMessage or have a dedicated handler for 'workerReady' without an ID.
            });

            // After worker is ready, explicitly initialize HNSW library in worker
            const hnswLibInitResult = await this.sendWorkerMessage({ type: 'initHnswLib' }, 'initHnswLib');
            if (!hnswLibInitResult.success) {
                throw new Error(`Failed to initialize HNSW library in worker: ${hnswLibInitResult.error}`);
            }
            this.isHnswLibInitializedInWorker = true;
            console.log('[EmbeddingService] HNSW library initialized in worker.');

            await this.loadModel(); // Load embedding model in worker
            console.log('Embedding worker and core libraries initialized successfully');
            this.isInitialized = true;

        } catch (error) {
            console.error('Failed to initialize embedding service:', error);
            this.cleanupWorker();
            this.isInitialized = false; // Ensure it's false on failure
            throw error; // Re-throw to indicate initialization failure
        } finally {
            this.isLoading = false;
        }
    }

    public async loadModel(): Promise<void> {
        if (!this.worker) throw new Error("Worker not initialized.");
        const result = await this.sendWorkerMessage({ type: 'loadModel', modelName: this.config.modelName }, 'loadModel');
        if (!result.status || result.status !== 'ready') {
            console.warn('Model loading in worker may not have completed successfully or reported status differently.', result);
        }
    }

    public async getQueryEmbedding(query: string, priority: number = 1): Promise<Float32Array | null> {
        await this.initialize(); // Always ensure initialization is complete or has been attempted
        if (!this.isInitialized) {
            console.error("EmbeddingService.getQueryEmbedding: Service not initialized after attempt.");
            throw new Error("Embedding service not initialized for getQueryEmbedding.");
        }
        if (!this.isInitialized) throw new Error("Embedding service not initialized.");
        if (!query) return null;

        const normalizedQuery = query.trim().toLowerCase();
        const cachedItem = this.embeddingCache.get(normalizedQuery);
        if (cachedItem) {
            cachedItem.timestamp = Date.now();
            return cachedItem.embedding;
        }

        try {
            return new Promise<Float32Array | null>((resolve, reject) => {
                const requestId = nanoid();
                this.pendingRequests.set(requestId, { resolve, reject, operation: 'embedQuery' });
                this.embeddingQueue.push({ id: requestId, query: normalizedQuery, priority, timestamp: Date.now(), resolve, reject });
                if (!this.processingQueue) {
                    this.processEmbeddingQueue();
                }
            });
        } catch (error) {
            console.error(`Error queuing embedding generation for query "${query}":`, error);
            return null;
        }
    }

    public async getAverageEmbedding(queries: string[]): Promise<Float32Array | null> {
        if (!queries || queries.length === 0) {
            console.warn('[EmbeddingService.getAverageEmbedding] Received empty or null queries array.');
            return null;
        }

        // Ensure service is initialized
        await this.initialize();
        if (!this.isInitialized) {
            console.error("[EmbeddingService.getAverageEmbedding] Service not initialized after attempt.");
            throw new Error("Embedding service not initialized for getAverageEmbedding.");
        }

        const individualEmbeddings: Float32Array[] = [];

        try {
            const embeddingPromises = queries.map(query => this.getQueryEmbedding(query.trim().toLowerCase()));
            const results = await Promise.all(embeddingPromises);

            for (const embedding of results) {
                if (embedding === null) {
                    console.warn('[EmbeddingService.getAverageEmbedding] One of the queries resulted in a null embedding. Averaging cannot proceed reliably.');
                    return null; // If any embedding fails, we can't reliably average.
                }
                if (embedding.length !== this.HNSW_DIMENSION) {
                    console.error(`[EmbeddingService.getAverageEmbedding] Embedding dimension mismatch. Expected ${this.HNSW_DIMENSION}, got ${embedding.length}.`);
                    return null;
                }
                individualEmbeddings.push(embedding);
            }
        } catch (error) {
            console.error('[EmbeddingService.getAverageEmbedding] Error fetching individual embeddings:', error);
            return null;
        }

        if (individualEmbeddings.length === 0) {
            console.warn('[EmbeddingService.getAverageEmbedding] No valid embeddings collected to average.');
            return null;
        }

        // Average the embeddings
        const numEmbeddings = individualEmbeddings.length;
        const dimension = this.HNSW_DIMENSION; // All embeddings should have this dimension
        const averageEmbedding = new Float32Array(dimension).fill(0);

        for (const embedding of individualEmbeddings) {
            for (let i = 0; i < dimension; i++) {
                averageEmbedding[i] += embedding[i];
            }
        }

        for (let i = 0; i < dimension; i++) {
            averageEmbedding[i] /= numEmbeddings;
        }

        return averageEmbedding;
    }

    private async processEmbeddingQueue(): Promise<void> {
        if (this.processingQueue || this.embeddingQueue.length === 0) return;
        this.processingQueue = true;
        try {
            this.embeddingQueue.sort((a, b) => (a.priority !== b.priority) ? (b.priority - a.priority) : (a.timestamp - b.timestamp));
            const requestDetails = this.embeddingQueue.shift()!; // We are sure queue is not empty

            // Check cache again, might have been populated by another request while this one was queued
            const cachedItem = this.embeddingCache.get(requestDetails.query);
            if (cachedItem) {
                requestDetails.resolve(cachedItem.embedding);
                this.processingQueue = false; // Release queue lock
                this.processEmbeddingQueue(); // Process next
                return;
            }

            const result = await this.sendWorkerMessage({ id: requestDetails.id, type: 'embedQuery', query: requestDetails.query }, 'embedQueryDirect');

            if (result && result.success && result.data && result.data.embedding) {
                if (this.embeddingCache.size >= (this.config.maxCacheSize || 100)) this.pruneCache();
                this.embeddingCache.set(requestDetails.query, { embedding: result.data.embedding, timestamp: Date.now() });
                requestDetails.resolve(result.data.embedding);
            } else {
                console.warn(`[EmbeddingService] Query embedding failed or no embedding in result for "${requestDetails.query}". Result:`, result);
                requestDetails.resolve(null);
            }
        } catch (error) {
            // If an error occurs in sendWorkerMessage or processing, reject the promise associated with the request
            // This assumes sendWorkerMessage correctly rejects.
            // The request is already shifted, so we just log. The promise in pendingRequests would be rejected by sendWorkerMessage.
            console.error('Error processing embedding queue item:', error);
            if (this.embeddingQueue.length > 0) { // If error was for current, try to reject it
                const currentReq = this.pendingRequests.get(this.embeddingQueue[0]?.id); // This logic is tricky
                if (currentReq) currentReq.reject(error as Error);
            }
        } finally {
            this.processingQueue = false;
            if (this.embeddingQueue.length > 0) this.processEmbeddingQueue();
        }
    }

    private pruneCache(): void {
        const entries = Array.from(this.embeddingCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const removeCount = Math.ceil(entries.length * 0.2);
        for (let i = 0; i < removeCount; i++) {
            if (entries[i]) this.embeddingCache.delete(entries[i][0]);
        }
    }

    // --- HNSW Methods (now delegating to worker) ---

    public async prepareHnswIndex(
        sourceProducts: Product[],
        forceRebuild: boolean = false,
        persistIndex: boolean = true,
        customFilename?: string
    ): Promise<void> {
        if (!this.isInitialized && !this.isLoading) {
            await this.initialize();
        } else if (this.isLoading) {
            // Await existing initialization if multiple calls happen during initial load
            // This requires `initialize` to return a promise that can be awaited multiple times
            // or manage an initialization promise internally. For now, just log.
            console.log("[EmbeddingService.prepareHnswIndex] Service is currently loading, awaiting existing initialization call to complete.");
            // A simple way to wait if another init is ongoing:
            while (this.isLoading && !this.isInitialized) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        if (!this.isInitialized || !this.isHnswLibInitializedInWorker) {
            console.error("[EmbeddingService.prepareHnswIndex] Critical: Service or HNSW Lib in worker still not initialized after waiting.");
            throw new Error("EmbeddingService or HNSW Lib in worker not initialized. Cannot prepare index.");
        }

        const filename = customFilename || this.config.hnswIndexFilename!;
        const numSourceProducts = sourceProducts ? sourceProducts.length : 0;
        const isTemporaryIndexOperation = !persistIndex;
        let operationId: string | undefined = undefined;

        if (isTemporaryIndexOperation) {
            operationId = nanoid(); // Generate unique ID for this temporary operation
            this.latestTemporaryOperationId = operationId; // Track the latest one
            console.log(`[EmbeddingService PREPARE START] Temporary Index Op (ID: ${operationId}). For ${numSourceProducts} products. Filename hint: "${filename}", forceRebuild: ${forceRebuild}`);
        } else {
            console.log(`[EmbeddingService PREPARE START] Global Index Op. For ${numSourceProducts} products. Filename: "${filename}", forceRebuild: ${forceRebuild}`);
        }


        // --- Skip logic (remains largely the same) ---
        if (persistIndex) { // Global index
            if (!forceRebuild && this.isGlobalHnswIndexReadyInWorker && this.globalHnswIndexSourceProductsRef === sourceProducts) {
                console.log(`[EmbeddingService PREPARE SKIP] GLOBAL HNSW index for "${filename}" already prepared.`);
                if (this.currentWorkerIndexContext !== 'global') await this.ensureCorrectWorkerContext('global', filename);
                this.isHnswIndexReadyInWorker = true; // Ensure active is also marked ready
                this.hnswIndexSourceProductsRef = sourceProducts; // And ref is correct
                return;
            }
        } else { // Temporary index
            // For temporary, we rely on forceRebuild=true from HybridDropdownStrategy.
            // The skip logic based on sourceProductsRef matching is less reliable for rapid dropdown changes.
            // The worker-side operationId check is the main guard for temporary indexes.
            // However, if somehow forceRebuild was false AND it's temporary AND sourceProducts matched, we could skip.
            // But HybridDropdownStrategy always sends forceRebuild=true.
            if (!forceRebuild && this.isHnswIndexReadyInWorker && this.hnswIndexSourceProductsRef === sourceProducts) {
                console.log(`[EmbeddingService PREPARE SKIP] TEMPORARY HNSW index (OpID: ${operationId}) already prepared for exact same products and not forcing rebuild. This case should be rare for dropdowns.`);
                if (this.currentWorkerIndexContext !== 'temporary') await this.ensureCorrectWorkerContext('temporary');
                return;
            }
        }
        console.log(`[EmbeddingService PREPARE PROCEED] OpID: ${operationId || 'N/A (Global)'}. Requesting worker to prepare HNSW index.`);


        if (persistIndex) {
            this.isGlobalHnswIndexReadyInWorker = false;
        }
        this.isHnswIndexReadyInWorker = false;

        const productsWithEmbeddingsData = sourceProducts
            .map((p, originalIndex) => ({ embedding: p.embedding, originalIndex }))
            .filter(p => p.embedding && p.embedding.length === this.HNSW_DIMENSION);

        if (productsWithEmbeddingsData.length === 0) {
            console.warn(`[EmbeddingService PREPARE ABORT] OpID: ${operationId || 'N/A (Global)'}. No products with valid embeddings.`);
            if (persistIndex) this.globalHnswIndexSourceProductsRef = sourceProducts; // Still update ref
            this.hnswIndexSourceProductsRef = sourceProducts;
            // Flags remain false
            return;
        }

        let initResult;
        try {
            console.log(`[EmbeddingService PREPARE] Sending 'initHnswIndex' to worker. OpID: ${operationId || 'N/A (Global)'}, MaxElements: ${productsWithEmbeddingsData.length}, Persist: ${persistIndex}`);
            initResult = await this.sendWorkerMessage({
                type: 'initHnswIndex',
                data: {
                    maxElements: productsWithEmbeddingsData.length, M: 16, efConstruction: 200, efSearch: 64,
                    filename: filename, forceRebuild: forceRebuild, persistIndex: persistIndex,
                    indexContext: persistIndex ? 'global' : 'temporary',
                    operationId: operationId // Pass operationId
                }
            }, `initHnswIndex (OpID: ${operationId || 'Global'})`);
        } catch (error) {
            console.error(`[EmbeddingService PREPARE] Error sending 'initHnswIndex' (OpID: ${operationId || 'Global'}):`, error);
            if (persistIndex) this.globalHnswIndexSourceProductsRef = null;
            this.hnswIndexSourceProductsRef = null;
            throw error;
        }

        if (!initResult || !initResult.success) {
            throw new Error(`[EmbeddingService PREPARE] Worker failed 'initHnswIndex' (OpID: ${operationId || 'Global'}): ${initResult?.error || 'Unknown worker error'}`);
        }

        const initData = initResult.data;
        this.currentWorkerIndexContext = persistIndex ? 'global' : 'temporary';
        if (persistIndex) this.globalHnswIndexSourceProductsRef = sourceProducts;
        this.hnswIndexSourceProductsRef = sourceProducts;


        if (initData?.loadedFromSave) {
            console.log(`[EmbeddingService PREPARE] Worker loaded HNSW index "${filename}" (OpID: ${operationId || 'Global'}) with ${initData.itemCount} items.`);
            if (persistIndex) this.isGlobalHnswIndexReadyInWorker = true;
            this.isHnswIndexReadyInWorker = true;
            return;
        }

        // If execution reaches here, we need to build the index by adding points.
        // For temporary indexes, check if this operation is still the latest one.
        if (isTemporaryIndexOperation && operationId !== this.latestTemporaryOperationId) {
            console.log(`[EmbeddingService PREPARE] Stale temporary operation (ID: ${operationId}) detected before adding points. Current latest is ${this.latestTemporaryOperationId}. Aborting addPoints for this stale op.`);
            // Mark as not ready, as addPoints was skipped.
            this.isHnswIndexReadyInWorker = false;
            // Do not throw an error, just don't proceed with addPoints for this stale operation.
            // The newer operation will handle setting the index ready.
            return;
        }

        console.log(`[EmbeddingService PREPARE] Requesting worker to build HNSW index (OpID: ${operationId || 'Global'}) with ${productsWithEmbeddingsData.length} items.`);
        let buildResult;
        try {
            buildResult = await this.sendWorkerMessage({
                type: 'addPointsToHnsw',
                data: {
                    points: productsWithEmbeddingsData.map(p => ({ embedding: p.embedding, label: p.originalIndex })),
                    indexContext: persistIndex ? 'global' : 'temporary',
                    operationId: operationId // Pass operationId
                }
            }, `addPointsToHnsw (OpID: ${operationId || 'Global'})`);
        } catch (error) {
            console.error(`[EmbeddingService PREPARE] Error sending 'addPointsToHnsw' (OpID: ${operationId || 'Global'}):`, error);
            // Reset ready flags as build failed
            if (persistIndex) this.isGlobalHnswIndexReadyInWorker = false;
            this.isHnswIndexReadyInWorker = false;
            throw error;
        }

        if (!buildResult || !buildResult.success) {
            // If the worker explicitly said it was a stale operation, don't throw an error,
            // as another operation is likely taking over.
            if (buildResult?.error === 'Stale addPoints operation for temporary context.') {
                console.warn(`[EmbeddingService PREPARE] Worker reported stale addPoints for OpID: ${operationId}. Another temp op likely active.`);
                this.isHnswIndexReadyInWorker = false; // This specific operation did not complete successfully.
                return;
            }
            throw new Error(`[EmbeddingService PREPARE] Worker failed 'addPointsToHnsw' (OpID: ${operationId || 'Global'}): ${buildResult?.error || 'Unknown worker error'}`);
        }


        console.log(`[EmbeddingService PREPARE] Worker built HNSW index (OpID: ${operationId || 'Global'}) with ${buildResult.data?.itemCount || 'unknown'} items.`);
        if (persistIndex) this.isGlobalHnswIndexReadyInWorker = true;
        this.isHnswIndexReadyInWorker = true;

        if (persistIndex) {
            console.log(`[EmbeddingService PREPARE] Requesting worker to save GLOBAL HNSW index "${filename}".`);
            // Fire and forget save for global index, or await if critical
            this.sendWorkerMessage({
                type: 'saveHnswIndexFile',
                data: { filename: filename, indexContext: 'global' }
            }, `saveHnswIndexFile (Global)`).then(saveResult => {
                if (saveResult && saveResult.success) console.log(`[EmbeddingService PREPARE] Worker confirmed GLOBAL HNSW index saved to "${filename}".`);
                else console.warn(`[EmbeddingService PREPARE] Worker failed to save GLOBAL HNSW index to "${filename}": ${saveResult?.error}`);
            }).catch(err => console.warn(`[EmbeddingService PREPARE] Error message for saving GLOBAL HNSW index to "${filename}":`, err));
        } else {
            console.log(`[EmbeddingService PREPARE] OpID: ${operationId}. Skipping save for temporary index.`);
        }
    }

    /**
     * Ensures the worker has the correct HNSW index context active
     */
    private async ensureCorrectWorkerContext(
        targetContext: 'global' | 'temporary',
        filename?: string
    ): Promise<void> {
        // If already in the correct context, skip
        if (this.currentWorkerIndexContext === targetContext) {
            return;
        }

        console.log(`[EmbeddingService] Switching worker HNSW context from ${this.currentWorkerIndexContext} to ${targetContext}${targetContext === 'global' && filename ? ` (${filename})` : ''}`);

        try {
            const result = await this.sendWorkerMessage({
                type: 'switchHnswContext',
                data: {
                    targetContext,
                    filename: targetContext === 'global' ? (filename || this.config.hnswIndexFilename) : undefined
                }
            }, 'switchHnswContext');

            if (result && result.success) {
                this.currentWorkerIndexContext = targetContext;
                console.log(`[EmbeddingService] Successfully switched worker HNSW context to ${targetContext}`);
            } else {
                console.error(`[EmbeddingService] Failed to switch worker HNSW context: ${result?.error || 'Unknown error'}`);
                // Don't update context tracking if switch failed
            }
        } catch (error) {
            console.error(`[EmbeddingService] Error switching worker HNSW context:`, error);
            // Don't update context tracking if switch failed
        }
    }

    public async rankBySimilarityHNSW(
        queryEmbedding: Float32Array,
        limit: number = 100
    ): Promise<Array<{ product: Product, originalProductIndex: number, similarity: number, score: number }>> {
        if (!this.isInitialized && !this.isLoading) await this.initialize();
        if (!this.isInitialized || !this.isHnswLibInitializedInWorker) {
            throw new Error("EmbeddingService or HNSW Lib in worker not initialized. Cannot search.");
        }
        if (!this.isHnswIndexReadyInWorker) {
            console.warn('[EmbeddingService] HNSW index in worker is not ready. Call prepareHnswIndex first.');
            return [];
        }
        if (!queryEmbedding || queryEmbedding.length !== this.HNSW_DIMENSION) {
            console.error('[EmbeddingService] Invalid query embedding for HNSW search.');
            return [];
        }
        if (!this.hnswIndexSourceProductsRef) {
            console.error('[EmbeddingService] hnswIndexSourceProductsRef is null. Cannot map results.');
            return [];
        }

        // Determine which index context we're using - if we're searching against the global product list,
        // make sure the worker has the global context active
        const isGlobalSearch = this.hnswIndexSourceProductsRef === this.globalHnswIndexSourceProductsRef;

        // If we're searching the global index but the worker has the temporary context active, switch contexts
        if (isGlobalSearch && this.currentWorkerIndexContext !== 'global') {
            console.log('[EmbeddingService] Need to switch to global context before searching');
            await this.ensureCorrectWorkerContext('global', this.config.hnswIndexFilename);
        }
        // If we're searching a temporary index but the worker has the global context active, switch contexts
        else if (!isGlobalSearch && this.currentWorkerIndexContext !== 'temporary') {
            console.log('[EmbeddingService] Need to switch to temporary context before searching');
            await this.ensureCorrectWorkerContext('temporary');
        }

        const result = await this.sendWorkerMessage({
            type: 'searchHnsw',
            data: {
                queryEmbedding,
                limit,
                indexContext: isGlobalSearch ? 'global' : 'temporary' // Tell worker which context to search
            }
        }, 'searchHnsw');

        if (!result.success) {
            console.error(`[EmbeddingService] HNSW search in worker failed: ${result.error}`);
            return [];
        }

        // Worker returns {neighbors: number[], distances: number[]}
        // These neighbors are the labels (original indices) we sent.
        const workerResults = result.data as { neighbors: number[], distances: number[] };
        const rankedProducts: Array<{ product: Product, originalProductIndex: number, similarity: number, score: number }> = [];

        if (workerResults && workerResults.neighbors && workerResults.distances) {
            for (let i = 0; i < workerResults.neighbors.length; i++) {
                const originalProductIndex = workerResults.neighbors[i]; // This is the originalIndex
                const distance = workerResults.distances[i];

                const product = this.hnswIndexSourceProductsRef[originalProductIndex];
                if (product) {
                    rankedProducts.push({
                        product,
                        originalProductIndex,
                        similarity: 1 - distance,
                        score: distance
                    });
                } else {
                    console.warn(`[EmbeddingService] Could not find product for originalIndex ${originalProductIndex} from HNSW search results.`);
                }
            }
        }
        return rankedProducts;
    }

    public cancelPendingRequests(): void {
        this.embeddingQueue.forEach(req => req.reject(new Error('Request cancelled by service')));
        this.embeddingQueue = [];
        this.pendingRequests.forEach((pending) => {
            if (pending.reject) {
                pending.reject(new Error(`Request cancelled: ${pending.operation || 'Unknown operation'}`));
            }
        });
        this.pendingRequests.clear();
    }

    public dispose(): void {
        this.cancelPendingRequests();
        this.cleanupWorker();
        this.isInitialized = false;
        this.isHnswLibInitializedInWorker = false;
        this.isHnswIndexReadyInWorker = false;
        this.isGlobalHnswIndexReadyInWorker = false;
        this.hnswIndexSourceProductsRef = null;
        this.globalHnswIndexSourceProductsRef = null;
        this.currentWorkerIndexContext = 'global';
        console.log("EmbeddingService disposed.");
    }

    private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
        const response = event.data;

        if (response.type === 'workerReady') {
            const readyPromiseId = this.findWorkerReadyRequestId();
            if (readyPromiseId) {
                const readyPromise = this.pendingRequests.get(readyPromiseId);
                if (readyPromise) {
                    readyPromise.resolve();
                    this.pendingRequests.delete(readyPromiseId);
                }
            } else if (response.id === 'initial-worker-ready-signal') { // Direct check for the signal from worker
                // This case might be redundant if findWorkerReadyRequestId works, but good fallback
                console.log('Worker is ready (initial signal received).');
            }
            return;
        }

        if (response.type === 'hnswBuildProgress') {

            return;
        }

        if (response.type === 'modelLoadingStatusUpdate') { // New type for progress

            return; // Don't treat as a promise fulfillment
        }

        if (!response.id) {
            console.warn('Received worker message with no ID (and not a known ID-less type):', response);
            return;
        }

        const pendingRequest = this.pendingRequests.get(response.id);
        if (!pendingRequest) {
            console.warn(`Received response for unknown or already handled request ID: ${response.id}`, response);
            return;
        }

        this.pendingRequests.delete(response.id);

        if (response.success === false || response.error) {
            console.error(`Error from worker for operation ${pendingRequest.operation} (ID: ${response.id}):`, response.error || 'Unknown worker error', response);
            pendingRequest.reject(new Error(response.error || `Worker operation ${pendingRequest.operation} failed`));
        } else {
            // For loadModel, ensure we're getting the 'ready' status
            if (pendingRequest.operation === 'loadModel' && response.type === 'modelLoadingStatus' && response.status !== 'ready') {
                // This shouldn't happen if worker only sends final 'ready' or 'error' with ID
                console.warn(`[EmbeddingService] loadModel promise resolved with non-ready status:`, response);
                // Re-queue or handle as error? For now, let it pass but log.
                // Or, better, the worker should ONLY send the final 'ready' or 'error' with the original ID.
                pendingRequest.reject(new Error(`loadModel resolved with status: ${response.status}`));
                return;
            }
            pendingRequest.resolve(response);
        }
    }

    // Helper to find the ID used for the workerReady promise during initialization
    private findWorkerReadyRequestId(): string | undefined {
        for (const [id, req] of this.pendingRequests.entries()) {
            if (req.operation === 'workerReady') {
                return id;
            }
        }
        return undefined;
    }

    private async sendWorkerMessage(messageData: Omit<WorkerMessage, 'id'> & { id?: string }, operationName?: string): Promise<any> {
        if (!this.worker && !this.isLoading && !this.isInitialized) {
            console.log("[sendWorkerMessage] Worker not ready, attempting to initialize service first...");
            await this.initialize();
        }
        if (!this.worker) {
            const errorMsg = 'Embedding worker not available or initialization failed';
            console.error(`[sendWorkerMessage] ${errorMsg} for operation: ${operationName}`);
            return Promise.reject(new Error(errorMsg));
        }

        return new Promise((resolve, reject) => {
            const id = messageData.id || nanoid(); // Use provided ID or generate new one
            const fullMessage: WorkerMessage = { ...messageData, id, type: messageData.type };

            this.pendingRequests.set(id, { resolve, reject, operation: operationName || messageData.type });
            try {
                this.worker!.postMessage(fullMessage);
            } catch (postError) {
                console.error(`[sendWorkerMessage] Error posting message to worker for operation ${operationName}:`, postError);
                this.pendingRequests.delete(id);
                reject(postError);
            }
        });
    }

    private cleanupWorker(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        // Reject any outstanding promises
        this.pendingRequests.forEach((pending) => {
            if (pending.reject) {
                pending.reject(new Error(`Worker was terminated during operation: ${pending.operation || 'Unknown operation'}`));
            }
        });
        this.pendingRequests.clear();
        this.isInitialized = false;
        this.isHnswLibInitializedInWorker = false;
        this.isHnswIndexReadyInWorker = false;
        this.isGlobalHnswIndexReadyInWorker = false;
        this.currentWorkerIndexContext = 'global';
    }
}

// Create singleton instance
export const embeddingService = new EmbeddingService();
