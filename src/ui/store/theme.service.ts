import { Injectable, effect, signal } from '@angular/core';
import type { Theme } from './model';

const STORAGE_KEY = 'envy:theme';

function readStoredTheme(): Theme {
	try {
		return globalThis.localStorage?.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
	} catch {
		return 'dark';
	}
}

/**
 * Owns the light/dark theme. Replaces Melodic's `applyTheme`.
 *
 * tokens.css keys off `[data-theme='light'|'dark']` on <html>, so the effect
 * below is what actually makes a theme change visible. It also mirrors the
 * choice to the main process, which recolors the Windows title-bar overlay
 * (a no-op on other platforms) — without that the caption buttons stay in the
 * old theme's colors and can end up invisible against the header.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
	private readonly _theme = signal<Theme>(readStoredTheme());

	readonly theme = this._theme.asReadonly();

	constructor() {
		effect(() => {
			const theme = this._theme();
			document.documentElement.setAttribute('data-theme', theme);
			try {
				globalThis.localStorage?.setItem(STORAGE_KEY, theme);
			} catch {
				/* localStorage unavailable */
			}
			try {
				window.envy.setWindowTheme(theme);
			} catch {
				/* preload bridge not ready (specs) — purely cosmetic */
			}
		});
	}

	set(theme: Theme): void {
		this._theme.set(theme);
	}

	toggle(): void {
		this._theme.update((current) => (current === 'dark' ? 'light' : 'dark'));
	}
}
