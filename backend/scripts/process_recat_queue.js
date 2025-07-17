// scripts/process_recat_queue.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const API_URL = 'http://localhost:3000/api/process-recategorization-queue';

async function processRecategorizationQueue() {
    try {
        console.log('Processing recategorization queue...');

        // Check if queue file exists
        const queuePath = path.join(__dirname, '../../product-categorization/products_to_recategorize.json');

        if (!fs.existsSync(queuePath)) {
            console.log('Recategorization queue file does not exist, creating empty file.');
            fs.writeFileSync(queuePath, JSON.stringify([]));
            console.log('No products to recategorize.');
            return;
        }

        // Check if queue has items
        const queueData = fs.readFileSync(queuePath, 'utf8');
        const queue = queueData.trim() ? JSON.parse(queueData) : [];

        if (queue.length === 0) {
            console.log('Recategorization queue is empty. Nothing to process.');
            return;
        }

        console.log(`Found ${queue.length} products in recategorization queue.`);

        // Call the API to process the queue
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API returned status ${response.status}: ${errorText}`);
        }

        const result = await response.json();

        if (result.success) {
            console.log(`Successfully processed ${result.processed} products from the recategorization queue.`);
            console.log(result.message || 'Products have been recategorized.');
        } else {
            console.error('Failed to process recategorization queue:', result.error || 'Unknown error');
        }

        // Verify queue is now empty
        if (fs.existsSync(queuePath)) {
            const updatedQueueData = fs.readFileSync(queuePath, 'utf8');
            const updatedQueue = updatedQueueData.trim() ? JSON.parse(updatedQueueData) : [];

            if (updatedQueue.length > 0) {
                console.warn(`Warning: Recategorization queue still contains ${updatedQueue.length} products after processing.`);
            } else {
                console.log('Recategorization queue is now empty.');
            }
        }

    } catch (error) {
        console.error('Error processing recategorization queue:', error);
        process.exit(1);
    }
}

// Run the main function
processRecategorizationQueue().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});