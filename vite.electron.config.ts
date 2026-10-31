import { defineConfig } from 'vite';

// Bundles the Electron shell. Run once per entry (--mode main, --mode preload) so
// each output is a single CommonJS file: a sandboxed preload cannot load siblings.
export default defineConfig(({ mode }) => ({
  build: {
    ssr: `electron/${mode}.ts`,
    outDir: 'dist-electron',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } },
  },
}));
