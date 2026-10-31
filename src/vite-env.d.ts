/// <reference types="vite/client" />

import type { P2Bridge } from '../p2/src/electron-preload.ts';

declare global {
  interface Window {
    p2?: P2Bridge;
    desktop?: { windowAction(action: 'minimize' | 'maximize' | 'close'): void; cloud?: import('@fyspoti/contracts').CloudBridge; playback?: import('@fyspoti/contracts').ScopedPlaybackBridge; catalog?: import('./services/desktop-catalog').CatalogBridge };
  }
}
