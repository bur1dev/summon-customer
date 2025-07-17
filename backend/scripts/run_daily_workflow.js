#!/usr/bin/env node
// run_daily_workflow.js - Simple workflow that creates a flag file for frontend
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LOG_FILE = path.join(__dirname, 'workflow_logs', `workflow_log_${new Date().toISOString().replace(/:/g, '-')}.log`);

// Create log directory if it doesn't exist
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Set up logger
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    // Log to console
    console.log(logMessage);

    // Append to log file
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Run the entire workflow
async function runWorkflow() {
    try {
        log('====== STARTING DAILY CATEGORIZATION WORKFLOW ======');

        // Step 1: Process the recategorization queue first
        log('\n----- STEP 1: PROCESSING RECATEGORIZATION QUEUE -----');
        await runProcess('process-recat-queue', 'node', [
            path.join(__dirname, 'process_recat_queue.js')
        ]);

        // Step 2: Get the location ID from environment or default
        const locationId = process.env.KROGER_LOCATION_ID || '70300168';
        log(`\n----- STEP 2: FETCHING PRODUCTS FROM KROGER API (Location: ${locationId}) -----`);

        // Fetch products from API
        // The runProcess for fetch-kroger-data.js should ideally return the path to the output file.
        // We'll assume krogerDataPath gets populated correctly by it.
        let krogerDataPath = await runProcess('fetch-kroger-data', 'node', [
            path.join(__dirname, 'fetch_kroger_data.js'),
            locationId
        ]);

        // Fallback logic if runProcess doesn't directly return the path or if the returned path is invalid.
        // This relies on the known output naming convention of fetch_kroger_data.js
        if (!krogerDataPath || !fs.existsSync(krogerDataPath)) {
            log(`[WORKFLOW_DEBUG] krogerDataPath from runProcess was '${krogerDataPath}' or file does not exist. Attempting to find latest output file...`);
            const outputDir = path.join(__dirname, 'output');
            if (fs.existsSync(outputDir)) {
                const files = fs.readdirSync(outputDir)
                    .filter(file => file.startsWith(`kroger_data_${locationId}_`) && file.endsWith('.json'))
                    .map(file => ({ file, mtime: fs.statSync(path.join(outputDir, file)).mtime }))
                    .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

                if (files.length > 0) {
                    krogerDataPath = path.join(outputDir, files[0].file);
                    log(`[WORKFLOW_DEBUG] Found most recent Kroger data output: ${krogerDataPath}`);
                } else {
                    log(`[WORKFLOW_ERROR] No Kroger data output files found in ${outputDir} for location ${locationId}.`);
                    throw new Error('Failed to fetch Kroger data: No output file found after fetch step.');
                }
            } else {
                log(`[WORKFLOW_ERROR] Output directory ${outputDir} does not exist.`);
                throw new Error('Failed to fetch Kroger data: Output directory missing.');
            }
        }

        if (!fs.existsSync(krogerDataPath)) { // Final check after attempting to find it
            throw new Error(`Failed to fetch Kroger data: Effective path '${krogerDataPath}' does not exist.`);
        }


        // Step 3: Process fetched data
        log(`\n----- STEP 3: PROCESSING FETCHED DATA (using ${krogerDataPath}) -----`);
        await runProcess('process-daily-updates', 'node', [
            path.join(__dirname, 'process_daily_updates.js'),
            krogerDataPath
        ]);
        // process_daily_updates.js will have created/updated categorized_products.json and categorized_products_sorted.json


        // Step 3.5: Find and Log Missing Products
        log(`\n----- STEP 3.5: FINDING PRODUCTS MISSING FROM FINAL CATEGORIZATION -----`);
        const finalCategorizedSortedPath = path.join(__dirname, '../../product-categorization/categorized_products_sorted.json');

        // Ensure krogerDataPath (output from fetch_kroger_data.js) is valid
        // and finalCategorizedSortedPath (output from process_daily_updates.js via sort_products.py) exists.
        if (krogerDataPath && fs.existsSync(krogerDataPath) && fs.existsSync(finalCategorizedSortedPath)) {
            log(`Comparing raw fetched data from: ${krogerDataPath}`);
            log(`Against final categorized data in: ${finalCategorizedSortedPath}`);
            try {
                // The 'result' from runProcess for find-missing-products isn't used here,
                // as find-missing-products.js writes its own output file.
                await runProcess('find-missing-products', 'node', [
                    path.join(__dirname, 'find-missing-products.js'),
                    krogerDataPath,         // Path to the raw Kroger fetch output from THIS run
                    finalCategorizedSortedPath   // Path to your final categorized & sorted products AFTER THIS run's updates
                ]);
                log(`find-missing-products.js completed. If any products were missing from this cycle's processing, they are saved to a 'missing_products_TIMESTAMP.json' file in the fetch output directory.`);
            } catch (findMissingError) {
                log(`Error during find-missing-products: ${findMissingError.message}. Continuing workflow.`);
                // Log the error but continue, as this is a diagnostic step.
            }
        } else {
            if (!krogerDataPath || !fs.existsSync(krogerDataPath)) {
                log(`Skipping find-missing-products: Input Kroger data file from fetch step not found or path is invalid (${krogerDataPath}). This could be due to an error in the fetch step.`);
            }
            if (!fs.existsSync(finalCategorizedSortedPath)) {
                log(`Skipping find-missing-products: Final categorized (sorted) product file not found (${finalCategorizedSortedPath}). This could be due to an error in process-daily-updates.`);
            }
        }


        // Step 4: Create flag file for frontend
        log(`\n----- STEP 4: CREATING DHT UPLOAD FLAG -----`);
        const flagDir = path.join(__dirname, '../../product-categorization');
        const flagPath = path.join(flagDir, 'needs_dht_upload.flag');

        // Ensure directory exists
        if (!fs.existsSync(flagDir)) {
            fs.mkdirSync(flagDir, { recursive: true });
        }

        // Write flag file
        fs.writeFileSync(flagPath, new Date().toISOString());
        log(`Created DHT upload flag at ${flagPath}`);
        log(`The frontend will detect this flag and can trigger syncDht() or loadFromSavedData()`);

        // Workflow completed successfully
        log('\n====== WORKFLOW COMPLETED SUCCESSFULLY ======');

        // Report summary
        await reportSummary();

    } catch (error) {
        log(`\n❌ ERROR: Workflow failed: ${error.message}`);
        log(`Stack trace: ${error.stack}`); // Added stack trace for better debugging

        // Try to generate partial summary if possible
        try {
            await reportSummary(true);
        } catch (summaryError) {
            log(`Failed to generate summary: ${summaryError.message}`);
        }

        process.exit(1);
    }
}

// Run a process and return its stdout
async function runProcess(label, command, args) {
    return new Promise((resolve, reject) => {
        log(`Starting process: ${command} ${args.join(' ')}`);

        const proc = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let result = null;

        proc.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;

            // Check for output lines that indicate a result file path
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.includes('output/kroger_data_') && line.includes('.json')) {
                    // Extract the Kroger data file path
                    const match = line.match(/output\/kroger_data_[^\.]+\.json/);
                    if (match) {
                        result = path.join(__dirname, match[0]);
                        log(`Detected output file: ${result}`);
                    }
                }
            }

            // Log stdout
            output.split('\n').filter(Boolean).forEach(line => {
                log(`[${label}] ${line}`);
            });
        });

        proc.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;

            // Log stderr
            output.split('\n').filter(Boolean).forEach(line => {
                log(`[${label} ERROR] ${line}`);
            });
        });

        proc.on('close', (code) => {
            if (code === 0) {
                log(`Process '${label}' completed successfully`);
                resolve(result); // Resolve with result file path if detected, otherwise null
            } else {
                log(`Process '${label}' failed with code ${code}`);
                reject(new Error(`${label} process exited with code ${code}: ${stderr}`));
            }
        });

        proc.on('error', (err) => {
            log(`Failed to start process '${label}': ${err.message}`);
            reject(err);
        });
    });
}

// Generate a summary report
async function reportSummary(isError = false) {
    log('\n----- WORKFLOW SUMMARY -----');

    try {
        // Check files and report counts
        const files = [
            {
                name: 'Categorized Products',
                path: path.join(__dirname, '../../product-categorization/categorized_products_sorted.json'),
                countFn: (data) => data.length
            },
            {
                name: 'Correction Map',
                path: path.join(__dirname, '../../product-categorization/correction_map.json'),
                countFn: (data) => Object.keys(data).length
            },
            {
                name: 'Recategorization Queue',
                path: path.join(__dirname, '../../product-categorization/products_to_recategorize.json'),
                countFn: (data) => data.length
            },
            {
                name: 'Failed Categorizations',
                path: path.join(__dirname, '../../product-categorization/failed_categorizations.jsonl'),
                countFn: (data) => data.trim().split('\n').length
            },
            {
                name: 'Changed Product Types',
                path: path.join(__dirname, '../../product-categorization/changed_product_types.json'),
                countFn: (data) => data.length,
                optional: true // This file might be deleted after successful DHT update
            }
        ];

        for (const file of files) {
            if (fs.existsSync(file.path)) {
                try {
                    const fileContent = fs.readFileSync(file.path, 'utf8');
                    if (fileContent.trim()) {
                        if (file.path.endsWith('.jsonl')) {
                            // Handle JSONL files
                            log(`${file.name}: ${file.countFn(fileContent)} entries`);
                        } else {
                            // Handle JSON files
                            const data = JSON.parse(fileContent);
                            log(`${file.name}: ${file.countFn(data)} entries`);
                        }
                    } else {
                        log(`${file.name}: 0 entries (empty file)`);
                    }
                } catch (err) {
                    log(`Error reading ${file.name}: ${err.message}`);
                }
            } else if (!file.optional) {
                log(`${file.name}: File not found`);
            } else {
                log(`${file.name}: Not present (may have been cleaned up after successful update)`);
            }
        }

        if (isError) {
            log('\nWorkflow encountered errors. Check the log file for details.');
        } else {
            log('\nWorkflow completed successfully!');
        }

        log(`Complete log saved to: ${LOG_FILE}`);

    } catch (error) {
        log(`Error generating summary: ${error.message}`);
    }
}

// Run the workflow
runWorkflow().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});