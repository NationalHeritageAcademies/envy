import type { EnvyApi } from '../ipc/contract';

declare global {
	interface Window {
		envy: EnvyApi;
	}
}

export {};
