import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Production CSP for the Electron renderer. Inline styles stay allowed because
// components set CSS custom properties through style attributes.
function contentSecurityPolicy(cloudUrl: string | undefined): Plugin {
  const policy = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:", "media-src 'self' https: p2-media:", "font-src 'self' data:",
    `connect-src 'self' https://itunes.apple.com${cloudUrl ? ' ' + new URL(cloudUrl).origin : ''}`,
    "object-src 'none'", "base-uri 'none'", "frame-src 'none'", "form-action 'none'",
  ].join('; ');
  return {
    name: 'fyspoti-csp',
    apply: 'build',
    transformIndexHtml: html => html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}"/>`),
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [contentSecurityPolicy(loadEnv(mode, process.cwd()).VITE_FYSPOTI_CLOUD_URL)],
  // Match tsconfig.frontend.json (react-jsx); Vite does not read that file itself.
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { 'node:crypto': fileURLToPath(new URL('./src/shims/node-crypto.ts', import.meta.url)) } },
}));
