import { Injectable, signal } from '@angular/core';
import type { DaemonStatus, EngineStatus, ImageSummary, ServiceView } from '../../ipc/contract';
import type { BusyKind, DockerProviderInfo } from './model';

/**
 * Everything the renderer knows about the Docker engine: the container and
 * image lists, engine/daemon health, the configured domains, and the transient
 * per-container action state the cards render spinners from.
 *
 * Writes funnel through the explicit setters below rather than exposing the
 * writable signals, so the only code that mutates engine state is the facade
 * that owns talking to the main process (see `envy.facade.ts`).
 */
@Injectable({ providedIn: 'root' })
export class DockerStateService {
	private readonly _services = signal<ServiceView[]>([]);
	private readonly _images = signal<ImageSummary[]>([]);
	private readonly _status = signal<EngineStatus | null>(null);
	private readonly _daemon = signal<DaemonStatus | null>(null);
	private readonly _domains = signal<string[]>([]);
	private readonly _loading = signal(true);
	private readonly _platform = signal<NodeJS.Platform>('darwin');
	private readonly _provider = signal<DockerProviderInfo | null>(null);
	private readonly _startingDocker = signal(false);
	private readonly _daemonBusy = signal(false);
	private readonly _busy = signal<Record<string, BusyKind>>({});
	private readonly _removeConfirm = signal<Record<string, boolean>>({});

	readonly services = this._services.asReadonly();
	readonly images = this._images.asReadonly();
	readonly status = this._status.asReadonly();
	readonly daemon = this._daemon.asReadonly();
	readonly domains = this._domains.asReadonly();
	readonly loading = this._loading.asReadonly();

	/** Host platform — drives OS-specific window chrome (mac traffic lights, etc.). */
	readonly platform = this._platform.asReadonly();

	/** Detected Docker provider, for the offline "Start"/"Install" button. */
	readonly provider = this._provider.asReadonly();
	readonly startingDocker = this._startingDocker.asReadonly();

	/** Transient "Starting daemon…" pill state during install. */
	readonly daemonBusy = this._daemonBusy.asReadonly();

	/** Per-container in-flight action, so a card can show a spinner on it. */
	readonly busy = this._busy.asReadonly();

	/** Inline two-step remove confirm, keyed by container id. */
	readonly removeConfirm = this._removeConfirm.asReadonly();

	setServices(value: ServiceView[]): void {
		this._services.set(value);
	}

	setImages(value: ImageSummary[]): void {
		this._images.set(value);
	}

	setStatus(value: EngineStatus | null): void {
		this._status.set(value);
	}

	setDaemon(value: DaemonStatus | null): void {
		this._daemon.set(value);
	}

	setDomains(value: string[]): void {
		this._domains.set(value);
	}

	setLoading(value: boolean): void {
		this._loading.set(value);
	}

	setPlatform(value: NodeJS.Platform): void {
		this._platform.set(value);
	}

	setProvider(value: DockerProviderInfo | null): void {
		this._provider.set(value);
	}

	setStartingDocker(value: boolean): void {
		this._startingDocker.set(value);
	}

	setDaemonBusy(value: boolean): void {
		this._daemonBusy.set(value);
	}

	setBusy(id: string, value: BusyKind | null): void {
		this._busy.update((current) => {
			const next = { ...current };
			if (value) next[id] = value;
			else delete next[id];
			return next;
		});
	}

	setRemoveConfirm(id: string, value: boolean): void {
		this._removeConfirm.update((current) => {
			const next = { ...current };
			if (value) next[id] = true;
			else delete next[id];
			return next;
		});
	}
}
