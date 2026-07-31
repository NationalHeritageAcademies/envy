import { Injectable, signal } from '@angular/core';
import type { AppSettings } from '../../ipc/contract';

/**
 * Persisted app preferences plus everything the Settings view and the header
 * update pill render: the installed version, the manual update-check state, and
 * the version of a staged auto-update waiting for a restart.
 */
@Injectable({ providedIn: 'root' })
export class AppSettingsService {
	private readonly _settings = signal<AppSettings>({ keepRunningInBackground: true, startAtLogin: false });
	private readonly _version = signal('');
	private readonly _updateChecking = signal(false);
	private readonly _updateCheckMsg = signal('');
	private readonly _updateReady = signal<string | null>(null);

	readonly settings = this._settings.asReadonly();

	/** Installed app version (package.json version), shown in Settings. */
	readonly version = this._version.asReadonly();

	readonly updateChecking = this._updateChecking.asReadonly();
	readonly updateCheckMsg = this._updateCheckMsg.asReadonly();

	/**
	 * Version of a downloaded-and-staged app update, or null when none is
	 * pending. Set from the electron-updater `update-downloaded` push event;
	 * drives the header "Restart to update" pill.
	 */
	readonly updateReady = this._updateReady.asReadonly();

	setSettings(value: AppSettings): void {
		this._settings.set(value);
	}

	setVersion(value: string): void {
		this._version.set(value);
	}

	setUpdateChecking(value: boolean): void {
		this._updateChecking.set(value);
	}

	setUpdateCheckMsg(value: string): void {
		this._updateCheckMsg.set(value);
	}

	setUpdateReady(value: string | null): void {
		this._updateReady.set(value);
	}
}
