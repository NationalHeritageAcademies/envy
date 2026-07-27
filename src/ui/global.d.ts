import type { EnvyApi } from '../ipc/contract.js';

declare global {
  interface Window {
    envy: EnvyApi;
  }
}

export {};
