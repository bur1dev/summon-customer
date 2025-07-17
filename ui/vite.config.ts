import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: {
    include: ["lucide-svelte"],
  },
  ssr: {
    noExternal: ["lucide-svelte"],
  },
  worker: { // Add this section
    format: 'es', // Explicitly set worker format to 'es'
    rollupOptions: { // You can also pass rollup options specifically for workers
      output: {
        format: 'es' // Redundant if worker.format is 'es', but for clarity
      }
    }
  }
});