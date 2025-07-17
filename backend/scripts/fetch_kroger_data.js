import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// THEN load environment variables with the path
dotenv.config({ path: path.join(__dirname, '../.env') });

// Add debug logging
console.log("Current directory:", __dirname);
console.log("Looking for .env file at:", path.join(__dirname, '../.env'));
console.log("Directly accessing .env vars:", {
    KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID,
    KROGER_CLIENT_SECRET_PREFIX: process.env.KROGER_CLIENT_SECRET?.substring(0, 4)
});

// --- Configuration ---
const LOCATION_ID_ARG_INDEX = 2;
const MAX_PAGES_PER_TERM = 6; // Corresponds to start <= 300 with limit=50
const API_LIMIT_BUFFER = 10; // Stop N requests before the hard limit
const REQUEST_DELAY_MS = 400; // Delay between product API calls
const KROGER_API_DAILY_LIMIT = 10000;
// --- End Configuration ---


// --- Global Token Variables ---
let accessToken = null;
let tokenExpiresAt = null;
// --- End Global Token Variables ---


const searchTerms = [
    '0004126001922'
];


// --- Helper Function: Get Access Token (Copied from your index.js) ---
async function getAccessToken() {
    const now = Date.now();

    if (accessToken && tokenExpiresAt && now < tokenExpiresAt) {
        return accessToken;
    }
    console.log("[AUTH] Fetching new access token...");

    // Debug environment variables
    console.log("[DEBUG] ENV vars loaded:", {
        client_id: process.env.KROGER_CLIENT_ID || "MISSING",
        secret_length: process.env.KROGER_CLIENT_SECRET ? process.env.KROGER_CLIENT_SECRET.length : 0,
        secret_starts_with: process.env.KROGER_CLIENT_SECRET ? process.env.KROGER_CLIENT_SECRET.substr(0, 4) : "MISSING"
    });

    // Create Basic Auth header
    const credentials = Buffer.from(`${process.env.KROGER_CLIENT_ID}:${process.env.KROGER_CLIENT_SECRET}`).toString('base64');
    console.log("[DEBUG] Basic auth:", `Basic ${credentials.substr(0, 10)}...`);

    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'product.compact'
    });
    console.log("[DEBUG] Request params:", params.toString());

    try {
        const response = await fetch('https://api.kroger.com/v1/connect/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${credentials}`
            },
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AUTH ERROR] Token request failed with status ${response.status}: ${errorText}`);
            throw new Error(`Token request failed with status ${response.status}`);
        }

        const data = await response.json();
        accessToken = data.access_token;
        tokenExpiresAt = now + (data.expires_in - 60) * 1000;

        console.log('[AUTH] Access token acquired successfully.');
        return accessToken;
    } catch (error) {
        console.error('[AUTH ERROR] Error fetching access token:', error.message);
        throw error;
    }
}
// --- End Helper Function ---


// --- Main Execution Logic ---
async function runFetch() {
    // --- Argument Handling ---
    const locationId = process.argv[LOCATION_ID_ARG_INDEX];
    if (!locationId) {
        console.error("Usage: node fetch_kroger_data.js <locationId>");
        console.error("Example: node fetch_kroger_data.js 70300168");
        process.exit(1); // Exit with error code
    }
    // --- End Argument Handling ---


    // --- Initialization ---
    const allProducts = [];
    const uniqueProductIds = new Set();
    let apiRequestCount = 0; // Counter for product API requests
    const startTime = Date.now();
    let limitReached = false;
    let fetchErrorOccurred = false;

    const outputDir = path.join(__dirname, 'output');
    const outputFileName = `kroger_data_${locationId}_${Date.now()}.json`;
    const outputFilePath = path.join(outputDir, outputFileName);
    const logFileName = `kroger_fetch_log_${locationId}_${Date.now()}.txt`;
    const logFilePath = path.join(outputDir, logFileName);
    // --- End Initialization ---


    // --- Setup Output ---
    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
            console.log(`Created output directory: ${outputDir}`);
        }
        // Clear or create log file
        fs.writeFileSync(logFilePath, `Log started at ${new Date().toISOString()}\n`);
        console.log(`Logging details to: ${logFilePath}`);
    } catch (err) {
        console.error(`Error setting up output directory/log file: ${err.message}`);
        process.exit(1);
    }

    // Simple logger function
    const log = (message) => {
        console.log(message);
        try {
            fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${message}\n`);
        } catch (logErr) {
            console.error("Failed to write to log file:", logErr.message);
        }
    };
    // --- End Setup Output ---


    log(`[FETCH START] Starting product fetch for location: ${locationId}.`);
    log(`Outputting products to: ${outputFilePath}`);
    log(`Total search terms configured: ${searchTerms.length}`);
    log(`Maximum pages per term: ${MAX_PAGES_PER_TERM}`);
    log(`Request delay: ${REQUEST_DELAY_MS}ms`);
    log(`API Limit Buffer: ${API_LIMIT_BUFFER}`);


    try {
        let termIndex = 0;
        for (const term of searchTerms) {
            termIndex++;
            let start = 0;
            const limit = 50; // Kroger API max limit per page
            let productsFoundForTermInRun = 0;
            let requestsForTerm = 0;
            const maxStart = (MAX_PAGES_PER_TERM - 1) * limit; // Calculate max start index based on config

            log(`[TERM ${termIndex}/${searchTerms.length}] Processing: "${term}"`);

            while (start <= maxStart) {
                // --- Pre-Request Checks ---
                if (apiRequestCount >= (KROGER_API_DAILY_LIMIT - API_LIMIT_BUFFER)) {
                    limitReached = true;
                    log(`[LIMIT REACHED] Approaching API limit (${apiRequestCount} requests). Stopping fetch before processing term "${term}" (start=${start}).`);
                    break; // Break inner while loop
                }
                // --- End Pre-Request Checks ---


                try {
                    const token = await getAccessToken(); // Get token (cached if possible)
                    const params = new URLSearchParams({
                        'filter.locationId': locationId,
                        'filter.limit': limit.toString(),
                        'filter.start': start.toString(),
                        'filter.term': term,
                        'filter.fulfillment': 'ais' // Available In Store
                    });

                    apiRequestCount++; // Increment PRODUCT API request counter *before* the request
                    requestsForTerm++;
                    log(` -> Request #${apiRequestCount} (Term: "${term}", Start: ${start})`);

                    const response = await fetch(`https://api.kroger.com/v1/products?${params.toString()}`, {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${token}`,
                        },
                        timeout: 15000 // Add a timeout (15 seconds)
                    });

                    // --- Response Handling ---
                    if (response.status === 429) {
                        limitReached = true;
                        log("[FATAL ERROR] Rate limit exceeded (429). Stopping entire process.");
                        throw new Error("Kroger API rate limit exceeded (429)."); // Throw to exit outer loop via catch
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        log(`[ERROR] API Response not OK for term "${term}" (Start: ${start}, Status: ${response.status}): ${errorText}`);
                        // Don't throw here, just break the loop for this term to try the next one
                        break;
                    }

                    const data = await response.json();

                    // --- Data Processing ---
                    if (!data.data?.length) {
                        log(` -> No more products found for term "${term}" at start=${start}.`);
                        break; // Exit while loop for this term
                    }

                    let newProductsCount = 0;
                    data.data.forEach(product => {
                        const hasPrice = (product.items?.[0]?.price?.regular || 0) > 0;
                        if (product.productId && hasPrice && !uniqueProductIds.has(product.productId)) {
                            allProducts.push(product);
                            uniqueProductIds.add(product.productId);
                            newProductsCount++;
                        }
                    });

                    productsFoundForTermInRun += data.data.length; // Total returned in this page
                    log(` -> Got ${data.data.length} products, ${newProductsCount} were new & valid. (Total unique: ${allProducts.length})`);

                    start += limit; // Prepare for next page

                } catch (fetchError) {
                    // Handle errors during the fetch itself (like network errors, timeouts, or the 429 thrown above)
                    log(`[FETCH/PROCESS ERROR] Error during fetch for term "${term}" (Start: ${start}): ${fetchError.message}`);
                    if (fetchError.message.includes("429")) {
                        throw fetchError; // Re-throw the fatal 429 error
                    }
                    // Otherwise, log and break the inner loop to move to the next term
                    break;
                }


                // --- Rate Limiting Delay ---
                await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

            } // End while loop (pagination for term)

            log(`[TERM ${termIndex}/${searchTerms.length}] Finished: "${term}". Found ~${productsFoundForTermInRun} results in this run across ${requestsForTerm} requests.`);

            // Check if outer loop needs to stop due to limit being hit
            if (limitReached) {
                log(`[LIMIT REACHED] Stopping outer loop as limit was hit or buffer reached.`);
                break; // Break the main for...of loop
            }

        } // End for loop (search terms)

    } catch (error) {
        // Catch major errors (like auth failure, 429, file system errors)
        log('[FATAL SCRIPT ERROR] An error occurred, stopping the script:');
        log(error.stack || error.message);
        fetchErrorOccurred = true;
    } finally {
        // --- Final Summary & Save ---
        const endTime = Date.now();
        const durationSeconds = Math.round((endTime - startTime) / 1000);
        const durationMinutes = (durationSeconds / 60).toFixed(2);

        log("==================================================");
        log("[FETCH SUMMARY]");
        log(`Status: ${fetchErrorOccurred ? 'FAILED' : (limitReached ? 'COMPLETED (LIMIT REACHED)' : 'COMPLETED')}`);
        log(`Duration: ${durationSeconds}s (~${durationMinutes} minutes)`);
        log(`Total Product API requests made: ${apiRequestCount}`);
        log(`Daily Limit Status: ${limitReached ? 'LIMIT HIT or BUFFER REACHED' : 'OK'}`);
        log(`Total unique products collected: ${allProducts.length}`);
        log(`Log file: ${logFilePath}`);
        log(`Product data file: ${outputFilePath}`);
        log("==================================================");

        // Attempt to save the collected data (even if partial)
        if (allProducts.length > 0) {
            log(`Attempting to save ${allProducts.length} collected products to ${outputFilePath}...`);
            try {
                fs.writeFileSync(outputFilePath, JSON.stringify(allProducts, null, 2)); // Pretty print
                log(`Successfully saved product data.`);
            } catch (saveError) {
                log(`[ERROR] Failed to save product data to file: ${saveError.message}`);
            }
        } else {
            log("No products collected, skipping file save.");
        }

        // Exit with appropriate code
        process.exit(fetchErrorOccurred ? 1 : 0);
    }
}

// --- Run the main function ---
runFetch();
// --- End Main Execution Logic ---