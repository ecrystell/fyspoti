import { build } from 'esbuild';

await build({
  entryPoints: ['./p2/src/electron-main.ts'],
  outfile: 'electron/p2-main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
});
