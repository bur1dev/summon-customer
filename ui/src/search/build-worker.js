// This file builds the web worker for Electron production
// It handles the bundling of the worker code for distribution

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

// Define paths
const workerSourcePath = path.resolve(__dirname, 'src/embedding-worker.ts');
const workerOutputPath = path.resolve(__dirname, 'public/embedding-worker.js');

// Ensure output directory exists
const outputDir = path.dirname(workerOutputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Build worker with esbuild
async function buildWorker() {
    try {
        const result = await esbuild.build({
            entryPoints: [workerSourcePath],
            bundle: true,
            outfile: workerOutputPath,
            platform: 'browser',
            format: 'iife',
            target: 'es2020',
            minify: process.env.NODE_ENV === 'production',
            sourcemap: process.env.NODE_ENV !== 'production',
            define: {
                'process.env.NODE_ENV': `"${process.env.NODE_ENV || 'development'}"`,
            },
        });

        console.log('Worker build complete:', result);
        console.log(`Worker built at: ${workerOutputPath}`);
    } catch (error) {
        console.error('Worker build failed:', error);
        process.exit(1);
    }
}

// Run the build
buildWorker();