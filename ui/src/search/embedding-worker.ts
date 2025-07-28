// Web Worker for embedding calculations AND HNSW operations
import { pipeline, env as transformersEnv } from '@xenova/transformers';
import { loadHnswlib } from 'hnswlib-wasm'; // For HNSW operations

// Configure Transformers.js for query embedding
transformersEnv.allowLocalModels = false;
transformersEnv.allowRemoteModels = true;
transformersEnv.useBrowserCache = true;

// Types for messages (should align with EmbeddingService.ts WorkerMessage)
interface WorkerMessage {
    id: string;
    type: 'loadModel' | 'embedQuery' | // Original types
    'initHnswLib' | 'initHnswIndex' | 'addPointsToHnsw' | 'searchHnsw' |
    'saveHnswIndexFile' | 'exportHnswFileData' | 'switchHnswContext' |
    'importHnswFileData' | 'syncIDBFS'; // Agent 2+ import type
    [key: string]: any;
}

// --- HNSW State within Worker ---
let hnswlib: any = null; // Loaded HNSW library instance (e.g., the object from loadHnswlib())

// New HNSW index management with separate contexts
interface HnswIndexContext {
    index: any;
    internalLabelMap: number[];
    populated: boolean;
    initialized: boolean;
    maxElements: number;
    filename?: string;
    currentOperationId?: string; // To track the latest init operation for this context
}

// Storage for different HNSW index contexts
const hnswContexts: Record<string, HnswIndexContext> = {
    global: {
        index: null,
        internalLabelMap: [],
        populated: false,
        initialized: false,
        maxElements: 0,
        filename: undefined,
        currentOperationId: undefined
    },
    temporary: {
        index: null,
        internalLabelMap: [],
        populated: false,
        initialized: false,
        maxElements: 0,
        filename: undefined,
        currentOperationId: undefined
    }
};

// Track the active context
let activeHnswContext: 'global' | 'temporary' = 'global';

const HNSW_DIMENSION = 384;
let isHnswLibCurrentlyLoading = false;
// --- End HNSW State ---

// --- Embedding Model State ---
let embeddingPipeline: any = null;
let embeddingModelName = 'Xenova/all-MiniLM-L12-v2';
let isEmbeddingModelLoading = false;
// --- End Embedding Model State ---

// Initialize worker and handle incoming messages
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;

    try {
        switch (message.type) {
            // Embedding model operations
            case 'loadModel':
                await handleLoadEmbeddingModel(message);
                break;
            case 'embedQuery':
                await handleEmbedQuery(message);
                break;
            // HNSW operations
            case 'initHnswLib':
                await handleInitHnswLib(message);
                break;
            case 'initHnswIndex': // Initializes or loads an index structure
                await handleInitHnswIndex(message);
                break;
            case 'addPointsToHnsw': // Adds points to the currently initialized index
                await handleAddPointsToHnsw(message);
                break;
            case 'searchHnsw':
                await handleSearchHnsw(message);
                break;
            case 'saveHnswIndexFile': // Explicit save command
                await handleSaveHnswIndexFile(message);
                break;
            case 'exportHnswFileData': // Export raw HNSW file data from Emscripten FS
                await handleExportHnswFileData(message);
                break;
            case 'switchHnswContext': // New handler for switching between contexts
                await handleSwitchHnswContext(message);
                break;
            case 'importHnswFileData': // Agent 2+ handler for importing HNSW binary data
                await handleImportHnswFileData(message);
                break;
            case 'syncIDBFS': // Agent 2+ handler for syncing IDBFS to Emscripten FS
                await handleSyncIDBFS(message);
                break;

            default:
                console.error(`[Worker] Unknown message type: ${message.type}`, message);
                sendMessage({ id: message.id, type: `${message.type}Result`, success: false, error: `Unknown message type: ${message.type}` });
        }
    } catch (error: any) {
        console.error(`[Worker] Top-level error handling message type ${message.type} (ID: ${message.id}):`, error);
        sendMessage({ id: message.id, type: `${message.type}Result`, success: false, error: error.message || 'Unknown error in worker main handler' });
    }
};

async function handleLoadEmbeddingModel(message: WorkerMessage) {
    const originalMessageId = message.id; // Store the ID for the final response

    if (message.modelName) embeddingModelName = message.modelName;

    if (embeddingPipeline) {
        return sendMessage({
            id: originalMessageId, // Use original ID
            type: 'modelLoadingStatus',
            status: 'ready',
            data: { message: `Model ${embeddingModelName} already loaded` },
            success: true
        });
    }
    if (isEmbeddingModelLoading) {
        // If already loading, we can't easily tie this new request to the ongoing load's promise.
        // For now, just inform. A more robust system might queue this or use a shared promise.
        return sendMessage({
            id: originalMessageId, // Use original ID
            type: 'modelLoadingStatus',
            status: 'loading',
            data: { message: `Model ${embeddingModelName} is already loading by a previous request.` },
            success: false // Indicate it's not fulfilling *this* specific request immediately
        });
    }

    isEmbeddingModelLoading = true;
    try {
        embeddingPipeline = await pipeline('feature-extraction', embeddingModelName, {
            progress_callback: (progress: any) => {
                // Send progress messages without an ID, or with a generic one not tied to a promise
                // These are "fire and forget" informational messages.
                sendMessage({
                    type: 'modelLoadingStatusUpdate', // Different type for progress
                    status: 'loading',
                    data: {
                        progress: progress.progress ? Math.round(progress.progress * 100) : undefined,
                        message: `${progress.status}: ${progress.file || ''}`
                    }
                });
            }
        });
        sendMessage({
            id: originalMessageId, // Use original ID for final success
            type: 'modelLoadingStatus',
            status: 'ready',
            data: { message: `Model ${embeddingModelName} loaded successfully` },
            success: true
        });
    } catch (error: any) {
        sendMessage({
            id: originalMessageId, // Use original ID for final error
            type: 'modelLoadingStatus',
            status: 'error',
            error: `Error loading model: ${error.message || 'Unknown error'}`,
            success: false
        });
    } finally {
        isEmbeddingModelLoading = false;
    }
}

async function handleEmbedQuery(message: WorkerMessage) {
    const { query } = message;
    if (!query || typeof query !== 'string') {
        return sendMessage({ id: message.id, type: 'queryEmbeddingResult', data: { embedding: null }, error: 'Invalid query', success: false });
    }
    if (!embeddingPipeline) {
        if (isEmbeddingModelLoading) {
            // If model is currently loading, wait for it to finish
            // This requires a promise or a polling mechanism. For simplicity, let's just inform and fail for now.
            // A more robust solution would be to queue this request until model is loaded.
            console.warn('[Worker] Embedding model is loading, query will likely fail or be delayed.');
            // To actually wait, handleLoadEmbeddingModel would need to return a promise that resolves when loading is done.
            // For now, let's ensure it tries to load if not loading.
            await handleLoadEmbeddingModel({ ...message, type: 'loadModel' }); // Try to load
        } else {
            // If not loaded and not currently loading, trigger load
            await handleLoadEmbeddingModel({ ...message, type: 'loadModel' });
        }
        // Check again after attempting to load
        if (!embeddingPipeline) {
            return sendMessage({ id: message.id, type: 'queryEmbeddingResult', data: { embedding: null }, error: 'Embedding model could not be loaded.', success: false });
        }
    }
    try {
        const embeddingTensor = await embeddingPipeline(query, { pooling: 'mean', normalize: true });
        const embedding = new Float32Array(embeddingTensor.data);
        sendMessage({ id: message.id, type: 'queryEmbeddingResult', data: { embedding }, success: true }, [embedding.buffer]);
    } catch (error: any) {
        sendMessage({ id: message.id, type: 'queryEmbeddingResult', data: { embedding: null }, error: `Error generating embedding: ${error.message || 'Unknown error'}`, success: false });
    }
}

// --- HNSW Handlers ---

async function ensureHnswLibLoadedInternal(): Promise<boolean> {
    if (hnswlib) return true;
    if (isHnswLibCurrentlyLoading) {
        // Simple wait mechanism if already loading
        await new Promise(resolve => setTimeout(resolve, 200)); // Check again
        return !!hnswlib;
    }
    isHnswLibCurrentlyLoading = true;
    console.log('[Worker HNSW] Loading hnswlib-wasm library in worker...');
    try {
        hnswlib = await loadHnswlib();
        console.log('[Worker HNSW] hnswlib-wasm library loaded successfully in worker.');
        return true;
    } catch (error: any) {
        console.error('[Worker HNSW] Failed to load hnswlib-wasm in worker:', error);
        hnswlib = null;
        throw error; // Re-throw to be caught by the calling handler
    } finally {
        isHnswLibCurrentlyLoading = false;
    }
}

async function handleInitHnswLib(message: WorkerMessage) {
    try {
        await ensureHnswLibLoadedInternal();
        sendMessage({ id: message.id, type: 'initHnswLibResult', success: true });
    } catch (error: any) {
        sendMessage({ id: message.id, type: 'initHnswLibResult', success: false, error: error.message });
    }
}

async function handleInitHnswIndex(message: WorkerMessage) {
    try {
        if (!await ensureHnswLibLoadedInternal()) {
            throw new Error('HNSW library failed to load or was not ready.');
        }

        const {
            maxElements,
            M = 16,
            efConstruction = 200,
            efSearch = 64,
            filename,
            forceRebuild = false,
            persistIndex = true,
            indexContext = 'global',
            operationId // Expect operationId from main thread
        } = message.data;

        if (indexContext !== 'global' && indexContext !== 'temporary') {
            throw new Error(`Invalid indexContext "${indexContext}". Must be "global" or "temporary".`);
        }
        if (indexContext === 'temporary' && !operationId) {
            console.warn('[Worker HNSW] Temporary index init called without an operationId. This might lead to race conditions.');
        }


        activeHnswContext = indexContext;
        let contextForThisOperation = hnswContexts[activeHnswContext];

        if (typeof maxElements !== 'number' || maxElements <= 0) {
            throw new Error('Invalid maxElements parameter for HNSW index initialization.');
        }

        if (activeHnswContext === 'temporary' || forceRebuild) {
            // Resetting HNSW context
            hnswContexts[activeHnswContext] = {
                index: null,
                internalLabelMap: [],
                populated: false,
                initialized: false,
                maxElements: 0,
                filename: (activeHnswContext === 'global' && persistIndex) ? filename : undefined,
                currentOperationId: activeHnswContext === 'temporary' ? operationId : undefined // Store operationId for temporary context
            };
            contextForThisOperation = hnswContexts[activeHnswContext];
        } else {
            contextForThisOperation.initialized = false;
            contextForThisOperation.populated = false;
            contextForThisOperation.index = null;
            contextForThisOperation.internalLabelMap = [];
            if (activeHnswContext === 'global' && persistIndex && filename && !contextForThisOperation.filename) {
                contextForThisOperation.filename = filename;
            }
            // For global, operationId is not as critical for this specific race condition
        }

        let loadedFromSave = false;
        let itemCountInIndex = 0;

        if (activeHnswContext === 'global' && !forceRebuild && persistIndex && contextForThisOperation.filename) {
            try {
                await hnswlib.EmscriptenFileSystemManager.syncFS(true, undefined);
                
                const fileExists = hnswlib.EmscriptenFileSystemManager.checkFileExists(contextForThisOperation.filename);
                if (fileExists) {
                    const newIndexInstance = new hnswlib.HierarchicalNSW('cosine', HNSW_DIMENSION, "");
                    await newIndexInstance.readIndex(contextForThisOperation.filename, maxElements);
                    contextForThisOperation.index = newIndexInstance;
                    contextForThisOperation.maxElements = newIndexInstance.getMaxElements();
                    newIndexInstance.setEfSearch(efSearch);
                    itemCountInIndex = newIndexInstance.getCurrentCount();
                    if (itemCountInIndex > 0) {
                        contextForThisOperation.populated = true;
                        contextForThisOperation.internalLabelMap = Array.from({ length: itemCountInIndex }, (_, i) => i);
                    }
                    loadedFromSave = true;
                } else {
                }
            } catch (loadError: any) {
                console.warn(`[Worker HNSW] Failed to load GLOBAL index from "${contextForThisOperation.filename}", will initialize a new one. Error:`, loadError.message);
                contextForThisOperation.index = null;
            }
        }

        if (!loadedFromSave) {
            contextForThisOperation.index = new hnswlib.HierarchicalNSW('cosine', HNSW_DIMENSION, "");
            contextForThisOperation.index.initIndex(maxElements, M, efConstruction, 100);
            contextForThisOperation.index.setEfSearch(efSearch);
            contextForThisOperation.internalLabelMap = [];
            contextForThisOperation.maxElements = maxElements;
            itemCountInIndex = 0;
            contextForThisOperation.populated = false;
            // If it's a temporary context being newly initialized, ensure its operationId is set
            if (activeHnswContext === 'temporary') {
                contextForThisOperation.currentOperationId = operationId;
            }
        }
        contextForThisOperation.initialized = true;

        sendMessage({
            id: message.id,
            type: 'initHnswIndexResult',
            success: true,
            data: {
                loadedFromSave: loadedFromSave,
                itemCount: itemCountInIndex,
                context: activeHnswContext,
                operationId: operationId // Send back operationId for confirmation if needed
            }
        });

    } catch (error: any) {
        console.error('[Worker HNSW] Error in handleInitHnswIndex:', error);
        const failedContextName = message.data?.indexContext || activeHnswContext;
        if (failedContextName && hnswContexts[failedContextName]) {
            hnswContexts[failedContextName].initialized = false;
            hnswContexts[failedContextName].populated = false;
            hnswContexts[failedContextName].index = null;
            hnswContexts[failedContextName].currentOperationId = undefined;
        }
        sendMessage({ id: message.id, type: 'initHnswIndexResult', success: false, error: error.message });
    }
}

async function handleAddPointsToHnsw(message: WorkerMessage) {
    const { points, indexContext: messageContext, operationId: messageOperationId } = message.data;
    const contextName = messageContext || activeHnswContext;
    const context = hnswContexts[contextName];

    if (!context || !context.index || !context.initialized) {
        return sendMessage({
            id: message.id, type: 'addPointsToHnswResult', success: false,
            error: `HNSW index not initialized in worker for context "${contextName}".`
        });
    }

    // For temporary contexts, only proceed if the operation ID matches the one set during init.
    // This prevents an "old" addPoints call from acting on a "newer" (re-initialized) temporary index.
    if (contextName === 'temporary') {
        if (!messageOperationId) {
            console.warn(`[Worker HNSW AddPoints] Temporary context addPoints called without operationId. Message ID: ${message.id}. Skipping.`);
            return sendMessage({ id: message.id, type: 'addPointsToHnswResult', success: false, error: 'Missing operationId for temporary context.', data: { context: contextName, itemCount: context.index.getCurrentCount() } });
        }
        if (context.currentOperationId !== messageOperationId) {
            return sendMessage({ id: message.id, type: 'addPointsToHnswResult', success: false, error: 'Stale addPoints operation for temporary context.', data: { context: contextName, itemCount: context.index.getCurrentCount() } });
        }
    }

    // Adding points to HNSW index

    if (!points || !Array.isArray(points)) {
        return sendMessage({ id: message.id, type: 'addPointsToHnswResult', success: false, error: 'Invalid points data.' });
    }

    // Check if console.time timer with this label already exists
    // This is a crude way to detect re-entrancy or overlapping calls for the same context if IDs aren't perfect.
    // However, the operationId check should be more robust.
    let timerLabel = `[Worker HNSW] Add points time for op ${messageOperationId || contextName}`;
    try {
        // Attempt to end it first in case a previous run errored out before ending it.
        // This is a bit of a hack; proper state management per operation is better.
        console.timeEnd(timerLabel);
    } catch (e) { /* Timer didn't exist, which is fine */ }
    console.time(timerLabel);


    if (context.index.getCurrentCount() === 0) { // Only reset label map if index is truly empty
        context.internalLabelMap = [];
    }


    try {
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (point.embedding && point.embedding.length === HNSW_DIMENSION && typeof point.label === 'number') {
                const embeddingArray = point.embedding instanceof Float32Array ? point.embedding : new Float32Array(point.embedding);
                const internalLabel = context.index.getCurrentCount();
                context.index.addPoint(embeddingArray, internalLabel, false);
                context.internalLabelMap[internalLabel] = point.label;
            }
            if (i > 0 && i % Math.max(1, Math.floor(points.length / 20)) === 0) {
                self.postMessage({ type: 'hnswBuildProgress', data: { progress: Math.round(((i + 1) / points.length) * 100), message: `Adding point ${i + 1}/${points.length}` } });
            }
        }
        context.populated = context.index.getCurrentCount() > 0;
        self.postMessage({ type: 'hnswBuildProgress', data: { progress: 100, message: `Finished adding points. Total items: ${context.index.getCurrentCount()}` } });
        sendMessage({
            id: message.id, type: 'addPointsToHnswResult', success: true,
            data: { itemCount: context.index.getCurrentCount(), context: contextName, operationId: messageOperationId }
        });
    } catch (error: any) {
        console.error(`[Worker HNSW] Error adding points to HNSW index (opId: ${messageOperationId}, context: ${contextName}):`, error);
        sendMessage({ id: message.id, type: 'addPointsToHnswResult', success: false, error: error.message, data: { operationId: messageOperationId } });
    } finally {
        try {
            console.timeEnd(timerLabel);
        } catch (e) { /* Timer might have been ended by an error path or already ended */ }
    }
}

async function handleSearchHnsw(message: WorkerMessage) {
    // Get context to use (default to active if not specified)
    const contextName = message.data.indexContext || activeHnswContext;
    const context = hnswContexts[contextName];

    if (!context || !context.index || !context.initialized || !context.populated) {
        return sendMessage({
            id: message.id,
            type: 'searchHnswResult',
            success: false,
            error: `HNSW index not ready or not populated in worker for context "${contextName}".`
        });
    }

    const { queryEmbedding, limit = 100 } = message.data;
    if (!queryEmbedding || queryEmbedding.length !== HNSW_DIMENSION) {
        return sendMessage({ id: message.id, type: 'searchHnswResult', success: false, error: 'Invalid query embedding.' });
    }

    try {

        const queryEmbeddingF32 = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);

        // Ensure limit doesn't exceed maxElements
        const effectiveLimit = Math.min(limit, context.maxElements);

        const rawResults = context.index.searchKnn(queryEmbeddingF32, effectiveLimit, undefined); // 3rd param filter

        const finalResults = {
            // Map internal HNSW labels back to the original product indices
            neighbors: rawResults.neighbors.map((internalLabel: number) => context.internalLabelMap[internalLabel]),
            distances: rawResults.distances
        };

        // Filter out any undefined mappings (if internalLabelMap was somehow incomplete)
        const validNeighbors: number[] = [];
        const validDistances: number[] = [];
        finalResults.neighbors.forEach((origIdx: any, i: number) => {
            if (typeof origIdx === 'number') {
                validNeighbors.push(origIdx);
                validDistances.push(finalResults.distances[i]);
            }
        });

        sendMessage({
            id: message.id,
            type: 'searchHnswResult',
            success: true,
            data: {
                neighbors: validNeighbors,
                distances: validDistances,
                context: contextName
            }
        });
    } catch (error: any) {
        console.error('[Worker HNSW] Error searching HNSW index:', error);
        sendMessage({ id: message.id, type: 'searchHnswResult', success: false, error: error.message });
    }
}

async function handleSaveHnswIndexFile(message: WorkerMessage) {
    // Get context to use (default to global since only global indices are saved)
    const contextName = message.data.indexContext || 'global';

    // Only allow saving global context
    if (contextName !== 'global') {
        return sendMessage({
            id: message.id,
            type: 'saveHnswIndexFileResult',
            success: false,
            error: 'Only the global context can be saved to a file.'
        });
    }

    const context = hnswContexts[contextName];

    if (!context || !context.index || !context.initialized || !context.populated) {
        return sendMessage({
            id: message.id,
            type: 'saveHnswIndexFileResult',
            success: false,
            error: `HNSW index not ready or not populated in worker for context "${contextName}", cannot save.`
        });
    }

    const { filename } = message.data;
    const actualFilename = filename || context.filename;

    if (!actualFilename) {
        return sendMessage({
            id: message.id,
            type: 'saveHnswIndexFileResult',
            success: false,
            error: 'Filename not provided for saving index.'
        });
    }

    try {
        console.log(`[Worker HNSW] 🔍 AGENT 1: About to call writeIndex("${actualFilename}")`);
        await context.index.writeIndex(actualFilename);
        console.log(`[Worker HNSW] 🔍 AGENT 1: writeIndex completed, about to syncFS(false)`);
        await hnswlib.EmscriptenFileSystemManager.syncFS(false, undefined); // Persist to IDBFS
        console.log(`[Worker HNSW] 🔍 AGENT 1: syncFS(false) completed`);
        
        // Test file accessibility immediately after write
        const fileExistsAfterWrite = hnswlib.EmscriptenFileSystemManager.checkFileExists(actualFilename);
        console.log(`[Worker HNSW] 🔍 AGENT 1: File exists after writeIndex("${actualFilename}"): ${fileExistsAfterWrite}`);
        
        console.log(`[Worker HNSW] ✅ AGENT 1: Index successfully saved to "${actualFilename}".`);

        // Update filename in context if it changed
        context.filename = actualFilename;

        sendMessage({
            id: message.id,
            type: 'saveHnswIndexFileResult',
            success: true,
            data: { context: contextName }
        });
    } catch (error: any) {
        console.error(`[Worker HNSW] Error saving HNSW index to "${actualFilename}":`, error);
        sendMessage({
            id: message.id,
            type: 'saveHnswIndexFileResult',
            success: false,
            error: error.message
        });
    }
}

/**
 * Handle requests to switch between global and temporary HNSW contexts
 */
async function handleSwitchHnswContext(message: WorkerMessage) {
    try {
        const { targetContext, filename } = message.data;

        if (targetContext !== 'global' && targetContext !== 'temporary') {
            throw new Error(`Invalid targetContext "${targetContext}". Must be "global" or "temporary".`);
        }

        console.log(`[Worker HNSW] Switching from "${activeHnswContext}" to "${targetContext}" context`);

        // If we're already in the requested context, just confirm success
        if (activeHnswContext === targetContext) {
            console.log(`[Worker HNSW] Already in "${targetContext}" context`);
            return sendMessage({
                id: message.id,
                type: 'switchHnswContextResult',
                success: true,
                data: { context: targetContext }
            });
        }

        // If switching to global context and it's not initialized but we have a filename,
        // try to load it from disk if available (without rebuilding)
        if (targetContext === 'global' && !hnswContexts.global.initialized && filename) {
            console.log(`[Worker HNSW] Global context not initialized. Attempting to load from "${filename}"...`);

            try {
                await hnswlib.EmscriptenFileSystemManager.syncFS(true, undefined);
                const exists = hnswlib.EmscriptenFileSystemManager.checkFileExists(filename);

                if (exists) {
                    console.log(`[Worker HNSW] Found existing global index file "${filename}". Loading...`);
                    const globalIndex = new hnswlib.HierarchicalNSW('cosine', HNSW_DIMENSION, "");
                    await globalIndex.readIndex(filename);

                    const globalContext = hnswContexts.global;
                    globalContext.index = globalIndex;
                    globalContext.initialized = true;
                    globalContext.filename = filename;

                    const itemCount = globalIndex.getCurrentCount();
                    globalContext.populated = itemCount > 0;
                    globalContext.maxElements = globalIndex.getMaxElements();

                    if (itemCount > 0) {
                        // Reconstruct label map
                        globalContext.internalLabelMap = Array.from({ length: itemCount }, (_, i) => i);
                    }

                    console.log(`[Worker HNSW] Successfully loaded global index from "${filename}" with ${itemCount} items.`);
                } else {
                    console.log(`[Worker HNSW] Global index file "${filename}" not found. Can't initialize global context.`);
                }
            } catch (loadError) {
                console.error(`[Worker HNSW] Error loading global index:`, loadError);
                // Continue with context switch even if load failed
            }
        }

        // Check if the requested context is initialized
        if (!hnswContexts[targetContext].initialized) {
            console.warn(`[Worker HNSW] Target context "${targetContext}" is not initialized yet.`);
        }

        // Switch the active context
        activeHnswContext = targetContext;

        sendMessage({
            id: message.id,
            type: 'switchHnswContextResult',
            success: true,
            data: {
                context: targetContext,
                initialized: hnswContexts[targetContext].initialized,
                populated: hnswContexts[targetContext].populated,
                maxElements: hnswContexts[targetContext].maxElements
            }
        });
    } catch (error: any) {
        console.error('[Worker HNSW] Error switching context:', error);
        sendMessage({
            id: message.id,
            type: 'switchHnswContextResult',
            success: false,
            error: error.message
        });
    }
}

/**
 * Export raw HNSW file data directly from Emscripten FS
 * This gives us just the binary index file without IDBFS bloat
 */
async function handleExportHnswFileData(message: WorkerMessage) {
    const { filename } = message.data || {};
    
    if (!hnswlib) {
        return sendMessage({
            id: message.id,
            type: 'exportHnswFileDataResult',
            success: false,
            error: 'HNSW library not initialized.'
        });
    }

    // Get the context (global or temporary)
    const contextKey = message.data?.indexContext || 'global';
    const context = hnswContexts[contextKey];
    
    if (!context || !context.index) {
        return sendMessage({
            id: message.id,
            type: 'exportHnswFileDataResult',
            success: false,
            error: `No HNSW index initialized for context: ${contextKey}`
        });
    }

    const actualFilename = filename || context.filename || 'global_search_index.dat';

    try {
        console.log(`[Worker HNSW] Exporting raw file data for "${actualFilename}"...`);
        
        // First save the index to Emscripten FS and sync to IDBFS
        await context.index.writeIndex(actualFilename);
        await hnswlib.EmscriptenFileSystemManager.syncFS(false, undefined);
        console.log(`[Worker HNSW] Index saved and synced to IDBFS`);
        
        // Now read the specific file from IDBFS IndexedDB
        const fileData = await readFileFromIDBFS(actualFilename);
        console.log(`[Worker HNSW] Raw HNSW file data: ${fileData.length} bytes`);
        
        // 🔍 AGENT 1 BINARY DEBUG: Show what correct data looks like
        console.log(`[Worker HNSW] 🔍 AGENT 1 first 32 bytes:`, Array.from(fileData.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.log(`[Worker HNSW] 🔍 AGENT 1 last 32 bytes:`, Array.from(fileData.slice(-32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        // Convert Uint8Array to regular Array for JSON serialization
        const fileDataArray = Array.from(fileData);
        
        sendMessage({
            id: message.id,
            type: 'exportHnswFileDataResult',
            success: true,
            data: {
                filename: actualFilename,
                fileData: fileDataArray,
                size: fileData.length
            }
        });
        
    } catch (error: any) {
        console.error(`[Worker HNSW] Error exporting raw file data:`, error);
        sendMessage({
            id: message.id,
            type: 'exportHnswFileDataResult',
            success: false,
            error: error.message || 'Failed to export HNSW file data.'
        });
    }
}

/**
 * Read a specific file from IDBFS IndexedDB
 * IDBFS stores files in the FILE_DATA object store
 */
async function readFileFromIDBFS(filename: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const openRequest = indexedDB.open('/hnswlib-index');
        
        openRequest.onerror = () => reject(new Error(`Failed to open IDBFS database`));
        
        openRequest.onsuccess = async (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            try {
                let storeNames = Array.from(db.objectStoreNames);
                let storeName = storeNames.includes('FILE_DATA') ? 'FILE_DATA' : storeNames[0];
                
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                
                const fullPath = `/hnswlib-index/${filename}`;
                
                const fileRequest = store.get(fullPath);
                
                const fileData = await new Promise<any>((resolve, reject) => {
                    fileRequest.onsuccess = () => {
                        if (fileRequest.result) {
                            resolve(fileRequest.result);
                        } else {
                            reject(new Error(`HNSW index file ${fullPath} not found in IDBFS`));
                        }
                    };
                    fileRequest.onerror = () => reject(fileRequest.error);
                });
                
                db.close();
                
                // The file data should be in the contents property
                const binaryData = fileData.contents;
                if (binaryData instanceof Uint8Array) {
                    resolve(binaryData);
                } else if (Array.isArray(binaryData)) {
                    resolve(new Uint8Array(binaryData));
                } else {
                    reject(new Error(`Invalid file data format for ${filename}`));
                }
                
            } catch (error) {
                db.close();
                reject(error);
            }
        };
    });
}

/**
 * Agent 2+ handler for importing HNSW binary data
 * 🎯 NEW APPROACH: Create temporary index from IndexedDB products, then writeIndex()
 */
async function handleImportHnswFileData(message: WorkerMessage) {
    const { filename, hnswBinaryData } = message.data || {};
    
    if (!hnswlib) {
        return sendMessage({
            id: message.id,
            type: 'importHnswFileDataResult',
            success: false,
            error: 'HNSW library not initialized.'
        });
    }

    if (!filename || !hnswBinaryData) {
        return sendMessage({
            id: message.id,
            type: 'importHnswFileDataResult',
            success: false,
            error: 'Missing filename or hnswBinaryData in import request.'
        });
    }

    try {
        console.log(`[Worker HNSW] 🚀 AGENT 2+ NEW APPROACH: Creating temporary index from products...`);
        
        // First, we need to get the products from IndexedDB to rebuild the index
        console.log(`[Worker HNSW] 🔧 AGENT 2+ STEP 1: Getting products from IndexedDB...`);
        const products = await getProductsFromIndexedDB();
        console.log(`[Worker HNSW] ✅ AGENT 2+ STEP 1: Got ${products.length} products from IndexedDB`);
        
        if (products.length === 0) {
            throw new Error('No products found in IndexedDB to rebuild HNSW index');
        }
        
        // Create temporary index and populate it
        console.log(`[Worker HNSW] 🔧 AGENT 2+ STEP 2: Creating temporary HNSW index...`);
        const tempIndex = new hnswlib.HierarchicalNSW('cosine', HNSW_DIMENSION, "");
        tempIndex.initIndex(products.length, 16, 200, 100);
        console.log(`[Worker HNSW] ✅ AGENT 2+ STEP 2: Temporary index initialized for ${products.length} products`);
        
        // Add products to the index
        console.log(`[Worker HNSW] 🔧 AGENT 2+ STEP 3: Adding products to temporary index...`);
        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            if (product.embedding && product.embedding.length === HNSW_DIMENSION) {
                const embeddingArray = product.embedding instanceof Float32Array ? 
                    product.embedding : new Float32Array(product.embedding);
                tempIndex.addPoint(embeddingArray, i, false);
            }
        }
        const addedCount = tempIndex.getCurrentCount();
        console.log(`[Worker HNSW] ✅ AGENT 2+ STEP 3: Added ${addedCount} products to temporary index`);
        
        // Now use Agent 1's proven writeIndex workflow
        console.log(`[Worker HNSW] 🔧 AGENT 2+ STEP 4: Using Agent 1's writeIndex workflow...`);
        await tempIndex.writeIndex(filename);
        console.log(`[Worker HNSW] ✅ AGENT 2+ STEP 4: writeIndex completed`);
        
        // Sync to IDBFS like Agent 1
        console.log(`[Worker HNSW] 🔧 AGENT 2+ STEP 5: Syncing to IDBFS like Agent 1...`);
        await hnswlib.EmscriptenFileSystemManager.syncFS(false, undefined);
        console.log(`[Worker HNSW] ✅ AGENT 2+ STEP 5: Sync completed`);
        
        // Verify with Agent 1's method
        const fileExists = hnswlib.EmscriptenFileSystemManager.checkFileExists(filename);
        console.log(`[Worker HNSW] 🔍 AGENT 2+ File exists after Agent 1 workflow: ${fileExists}`);
        
        if (!fileExists) {
            throw new Error(`File ${filename} not accessible after Agent 1 workflow`);
        }
        
        const finalIDBFSSize = await getIDBFSStorageSize();
        console.log(`[Worker HNSW] ✅ AGENT 2+ SUCCESS: Index rebuilt using Agent 1 workflow! IDBFS size: ${finalIDBFSSize} bytes`);
        
        sendMessage({
            id: message.id,
            type: 'importHnswFileDataResult',
            success: true,
            data: {
                filename,
                verified: fileExists,
                productCount: addedCount,
                method: 'rebuild-from-products',
                finalIDBFSSize: finalIDBFSSize
            }
        });
        
    } catch (error: any) {
        console.error(`[Worker HNSW] ❌ AGENT 2+ Error importing HNSW binary data:`, error);
        sendMessage({
            id: message.id,
            type: 'importHnswFileDataResult',
            success: false,
            error: error.message || 'Failed to import HNSW binary data.'
        });
    }
}

/**
 * Handle IDBFS sync request from main thread
 * This syncs IDBFS → Emscripten FS so worker can access files written by main thread
 */
async function handleSyncIDBFS(message: WorkerMessage) {
    try {
        console.log('[Worker HNSW] 🔄 Syncing IDBFS to Emscripten FS...');
        
        if (!hnswlib || !hnswlib.EmscriptenFileSystemManager) {
            throw new Error('hnswlib not initialized');
        }
        
        // Trigger IDBFS → Emscripten FS sync
        await hnswlib.EmscriptenFileSystemManager.syncFS(true, undefined);
        
        console.log('[Worker HNSW] ✅ IDBFS sync completed - files should now be visible to Emscripten FS');
        
        sendMessage({
            id: message.id,
            type: 'syncIDBFSResult',
            success: true
        });
        
    } catch (error: any) {
        console.error('[Worker HNSW] ❌ IDBFS sync failed:', error);
        sendMessage({
            id: message.id,
            type: 'syncIDBFSResult',
            success: false,
            error: error.message || 'IDBFS sync failed'
        });
    }
}

/**
 * Get products with embeddings from IndexedDB using the correct chunk format
 */
async function getProductsFromIndexedDB(): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const openRequest = indexedDB.open('product-search-cache');
        
        openRequest.onerror = () => reject(new Error('Failed to open IndexedDB'));
        
        openRequest.onsuccess = async (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            try {
                console.log(`[Worker HNSW] 🔍 IndexedDB object stores:`, Array.from(db.objectStoreNames));
                
                const tx = db.transaction(['products'], 'readonly');
                const store = tx.objectStore('products');
                
                // Get all keys first to see what's there
                const keysRequest = store.getAllKeys();
                const keys = await new Promise<any[]>((resolve, reject) => {
                    keysRequest.onsuccess = () => resolve(keysRequest.result || []);
                    keysRequest.onerror = () => reject(keysRequest.error);
                });
                
                console.log(`[Worker HNSW] 🔍 Found IndexedDB keys:`, keys);
                
                // Get all data
                const getAllRequest = store.getAll();
                const allData = await new Promise<any[]>((resolve, reject) => {
                    getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
                    getAllRequest.onerror = () => reject(getAllRequest.error);
                });
                
                console.log(`[Worker HNSW] 🔍 Raw IndexedDB data:`, allData.length, 'items');
                
                db.close();
                
                // Parse chunk data (the format SearchCacheService uses)
                let allProducts: any[] = [];
                
                for (const item of allData) {
                    if (item.key && item.key.startsWith('chunk_')) {
                        console.log(`[Worker HNSW] 🔍 Processing chunk: ${item.key}`);
                        console.log(`[Worker HNSW] 🔍 Chunk item structure:`, Object.keys(item));
                        console.log(`[Worker HNSW] 🔍 Chunk item value:`, item.value);
                        console.log(`[Worker HNSW] 🔍 Chunk products array:`, item.products?.length || 'NO PRODUCTS ARRAY');
                        
                        if (item.products && Array.isArray(item.products)) {
                            allProducts.push(...item.products);
                        } else if (item.value && Array.isArray(item.value)) {
                            // Maybe products are in item.value instead
                            console.log(`[Worker HNSW] 🔍 Trying item.value as products array: ${item.value.length} items`);
                            allProducts.push(...item.value);
                        }
                    }
                }
                
                console.log(`[Worker HNSW] 🔍 Total products from chunks: ${allProducts.length}`);
                
                // Filter products that have embeddings
                const productsWithEmbeddings = allProducts.filter(product => 
                    product.embedding && 
                    (product.embedding instanceof Float32Array || Array.isArray(product.embedding)) &&
                    product.embedding.length === HNSW_DIMENSION
                );
                
                console.log(`[Worker HNSW] 🔍 Products with embeddings: ${productsWithEmbeddings.length}`);
                resolve(productsWithEmbeddings);
                
            } catch (error) {
                console.error(`[Worker HNSW] ❌ Error reading IndexedDB:`, error);
                db.close();
                reject(error);
            }
        };
    });
}


/**
 * Get total size of IDBFS storage for monitoring
 */
async function getIDBFSStorageSize(): Promise<number> {
    return new Promise((resolve) => {
        const openRequest = indexedDB.open('/hnswlib-index');
        
        openRequest.onerror = () => resolve(0);
        
        openRequest.onsuccess = async (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            try {
                let totalSize = 0;
                let storeNames = Array.from(db.objectStoreNames);
                
                for (const storeName of storeNames) {
                    const tx = db.transaction([storeName], 'readonly');
                    const store = tx.objectStore(storeName);
                    const getAllRequest = store.getAll();
                    
                    const allData = await new Promise<any[]>((resolve, reject) => {
                        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
                        getAllRequest.onerror = () => reject(getAllRequest.error);
                    });
                    
                    for (const record of allData) {
                        if (record.contents && record.contents.length) {
                            totalSize += record.contents.length;
                        }
                    }
                }
                
                db.close();
                resolve(totalSize);
                
            } catch (error) {
                db.close();
                resolve(0);
            }
        };
    });
}


// --- IDBFS Utility Functions ---



// Removed unused listIDBFSFiles function

// --- Utility Functions ---
function sendMessage(message: any, transfer?: Transferable[]) {
    self.postMessage(message, transfer || []);
}

// Notify main thread that worker is ready for initial setup
// The main thread's initialize() method sets up a promise that listens for this.
// It's important that the ID here is either not used by main thread to track a specific promise,
// or that the main thread has a special way to handle this one-off "ready" signal.
sendMessage({ type: 'workerReady', id: 'initial-worker-ready-signal' }); // Use a distinct ID or convention