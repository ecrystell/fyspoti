/// <reference types="vite/client" />
interface Window {
  desktop?: { windowAction(action: 'minimize' | 'maximize' | 'close'): void; cloud?: import('@fyspoti/contracts').CloudBridge };
}
