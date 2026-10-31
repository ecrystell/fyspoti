import { defineConfig } from 'vite';
export default defineConfig(({ command }) => ({
  base: './',
  esbuild: { jsx: 'automatic' },
  plugins: [{ name: 'desktop-csp', transformIndexHtml: () => [{ tag: 'meta', attrs: {
    'http-equiv': 'Content-Security-Policy',
    content: ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.mzstatic.com https://i.scdn.co https://image-cdn-ak.spotifycdn.com https://mosaic.scdn.co https://pickasso.spotifycdn.com",
      `connect-src 'self' https://itunes.apple.com${command === 'serve' ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
      "media-src 'self' https://*.itunes.apple.com", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; '),
  } }] }],
}));
