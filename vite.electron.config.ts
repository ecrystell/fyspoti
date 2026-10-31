import { defineConfig } from 'vite';

// Bundles the Electron shell. Run once per entry (--mode main, --mode preload) so
// each output is a single CommonJS file: a sandboxed preload cannot load siblings.
export default defineConfig(({ mode }) => ({
  // Workspace packages are ESM-only; bundle them (and their dependencies) into the CommonJS main file.
  ssr: { noExternal: [/^@fyspoti\//, 'zod', 'fflate'] },
  build: {
    ssr: `electron/${mode}.ts`,
    outDir: 'dist-electron',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } },
  },
}));
