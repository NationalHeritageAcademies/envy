import type { EnvyApi } from '../../ipc/contract';

/** The five top-level screens, keyed by the sidebar nav. */
export type View = 'services' | 'images' | 'domains' | 'activity' | 'settings';

/** Envy is dark-first; 'system' is deliberately not an option. */
export type Theme = 'dark' | 'light';

/** Which pane the inspect drawer is showing. */
export type DrawerTab = 'logs' | 'shell';

/** The in-flight container action a card/drawer is showing a spinner for. */
export type BusyKind = 'start' | 'stop' | 'restart' | 'remove';

/**
 * The detected Docker provider (OrbStack / Docker Desktop / colima / …).
 * Derived from the contract so the shape can't drift from what the main
 * process actually sends.
 */
export type DockerProviderInfo = Awaited<ReturnType<EnvyApi['dockerProvider']>>;

/** Compose project (or the synthetic "Standalone" bucket) with its members. */
export interface ServiceGroup<T> {
	project: string;
	standalone: boolean;
	services: T[];
}

/** Docker Compose labels Envy reads to group and name services. */
export const PROJECT_LABEL = 'com.docker.compose.project';
export const SERVICE_LABEL = 'com.docker.compose.service';

/** The bucket standalone (non-Compose) containers are grouped under. */
export const STANDALONE = 'Standalone';
