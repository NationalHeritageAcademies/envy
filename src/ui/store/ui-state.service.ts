import { Injectable, signal } from '@angular/core';
import type { DrawerTab, View } from './model';

const STORAGE_GROUPS = 'envy:collapsedGroups';
const STORAGE_DRAWER_W = 'envy:drawerWidth';

/** Narrowest the inspect drawer can be dragged before the content breaks up. */
export const DRAWER_MIN_WIDTH = 380;

/** Default drawer width, and what the expand toggle collapses back to. */
export const DRAWER_DEFAULT_WIDTH = 436;

function loadJson<T>(key: string, fallback: T): T {
	try {
		const raw = globalThis.localStorage?.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function persist(key: string, value: string): void {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {
		/* localStorage unavailable — persistence is a nicety, the session still works */
	}
}

/**
 * Purely presentational state: which screen is showing, which Compose groups
 * are collapsed, and the inspect drawer's target/tab/width.
 *
 * Kept separate from `DockerStateService` so a Docker reconnect (which replaces
 * the whole container list) never has to reason about, or accidentally reset,
 * what the user has open.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
	private readonly _view = signal<View>('services');
	private readonly _collapsedGroups = signal<Record<string, boolean>>(loadJson(STORAGE_GROUPS, {}));
	private readonly _inspect = signal<string | null>(null);
	private readonly _drawerTab = signal<DrawerTab>('logs');
	private readonly _inspectConfirm = signal(false);
	private readonly _drawerWidth = signal<number>(Number(globalThis.localStorage?.getItem(STORAGE_DRAWER_W)) || DRAWER_DEFAULT_WIDTH);
	private readonly _runOpen = signal(false);
	private readonly _runPrefillImage = signal('');

	readonly view = this._view.asReadonly();

	/** Collapsed Compose-project groups (keyed by project name), persisted. */
	readonly collapsedGroups = this._collapsedGroups.asReadonly();

	/** The container id the inspect drawer is showing, or null when closed. */
	readonly inspect = this._inspect.asReadonly();
	readonly drawerTab = this._drawerTab.asReadonly();

	/** The drawer's own remove-confirm flag, independent of the card's. */
	readonly inspectConfirm = this._inspectConfirm.asReadonly();
	readonly drawerWidth = this._drawerWidth.asReadonly();

	readonly runOpen = this._runOpen.asReadonly();

	/** Image reference the Run dialog should open prefilled with, if any. */
	readonly runPrefillImage = this._runPrefillImage.asReadonly();

	setView(value: View): void {
		this._view.set(value);
	}

	toggleGroup(project: string): void {
		this._collapsedGroups.update((current) => {
			const next = { ...current, [project]: !current[project] };
			persist(STORAGE_GROUPS, JSON.stringify(next));
			return next;
		});
	}

	openInspect(id: string): void {
		this._inspect.set(id);
		this._drawerTab.set('logs');
		this._inspectConfirm.set(false);
	}

	closeInspect(): void {
		this._inspect.set(null);
		this._inspectConfirm.set(false);
	}

	setDrawerTab(value: DrawerTab): void {
		this._drawerTab.set(value);
	}

	setInspectConfirm(value: boolean): void {
		this._inspectConfirm.set(value);
	}

	setDrawerWidth(px: number): void {
		this._drawerWidth.set(px);
		persist(STORAGE_DRAWER_W, String(Math.round(px)));
	}

	openRun(image = ''): void {
		this._runPrefillImage.set(image);
		this._runOpen.set(true);
	}

	closeRun(): void {
		this._runOpen.set(false);
	}

	/** The dialog consumes the prefill on open so a later reopen starts blank. */
	consumeRunPrefill(): string {
		const image = this._runPrefillImage();
		this._runPrefillImage.set('');
		return image;
	}
}
