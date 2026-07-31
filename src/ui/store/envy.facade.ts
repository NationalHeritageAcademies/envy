import { Injectable, inject } from '@angular/core';
import type { AppSettings, EnvyApi, RunOptions } from '../../ipc/contract';
import { showToast } from '../components/toast';
import { AppSettingsService } from './app-settings.service';
import { DockerStateService } from './docker-state.service';
import type { BusyKind } from './model';
import { UiStateService } from './ui-state.service';

/**
 * The single writer over `DockerStateService` / `AppSettingsService`: every
 * call into the main process lives here, along with the state updates and user
 * feedback that follow it. Components inject the facade for actions and the
 * state services for reads, so no component ever calls `window.envy` for a
 * mutation — the one exception is the streaming subscriptions (logs, stats,
 * exec), which are owned by the component that renders them and must be torn
 * down with it.
 */
@Injectable({ providedIn: 'root' })
export class EnvyFacade {
	private readonly docker = inject(DockerStateService);
	private readonly appSettings = inject(AppSettingsService);
	private readonly ui = inject(UiStateService);

	private get api(): EnvyApi {
		return window.envy;
	}

	// ── Reloads ─────────────────────────────────────────────────────────────

	async reloadServices(): Promise<void> {
		this.docker.setServices(await this.api.listServices());
	}

	async reloadImages(): Promise<void> {
		this.docker.setImages(await this.api.listImages());
	}

	async reloadStatus(): Promise<void> {
		this.docker.setStatus(await this.api.getStatus());
	}

	async reloadDomains(): Promise<void> {
		this.docker.setDomains(await this.api.getDomains());
	}

	async reloadDaemon(): Promise<void> {
		this.docker.setDaemon(await this.api.daemonStatus());
	}

	// ── Container actions ───────────────────────────────────────────────────

	private async withBusy(id: string, kind: BusyKind, fn: () => Promise<void>): Promise<void> {
		this.docker.setBusy(id, kind);
		try {
			await fn();
			await this.reloadServices();
		} catch (err) {
			showToast(`${kind} failed: ${(err as Error).message}`, 'error');
		} finally {
			this.docker.setBusy(id, null);
		}
	}

	startService(id: string): Promise<void> {
		return this.withBusy(id, 'start', () => this.api.startContainer(id));
	}

	stopService(id: string): Promise<void> {
		return this.withBusy(id, 'stop', () => this.api.stopContainer(id));
	}

	restartService(id: string): Promise<void> {
		return this.withBusy(id, 'restart', () => this.api.restartContainer(id));
	}

	/** Two-step remove: first click arms the confirm; confirm runs it. */
	armRemove(id: string): void {
		this.docker.setRemoveConfirm(id, true);
	}

	cancelRemove(id: string): void {
		this.docker.setRemoveConfirm(id, false);
	}

	async confirmRemove(id: string): Promise<void> {
		this.docker.setRemoveConfirm(id, false);
		if (this.ui.inspect() === id) this.ui.closeInspect();
		await this.withBusy(id, 'remove', () => this.api.removeContainer(id));
		showToast('Container removed', 'success');
	}

	async runContainer(opts: RunOptions): Promise<void> {
		showToast(`Starting ${opts.image}…`, 'info');
		try {
			await this.api.runContainer(opts);
			await this.reloadServices();
			showToast(`Running ${opts.name || opts.image}`, 'success');
		} catch (err) {
			showToast(`Run failed: ${(err as Error).message}`, 'error');
			throw err;
		}
	}

	/** Pull the latest of a container's image + recreate it on the new image. */
	async recreateContainer(id: string): Promise<void> {
		this.docker.setBusy(id, 'restart');
		showToast('Updating to latest image…', 'info');
		try {
			await this.api.recreateContainer(id);
			await this.reloadServices();
			showToast('Updated to latest image', 'success');
		} catch (err) {
			showToast(`Update failed: ${(err as Error).message}`, 'error');
		} finally {
			this.docker.setBusy(id, null);
		}
	}

	// ── Docker engine ───────────────────────────────────────────────────────

	/** Launch the detected Docker provider; the status push connects when it's up. */
	async startDocker(): Promise<void> {
		this.docker.setStartingDocker(true);
		showToast(`Starting ${this.docker.provider()?.name ?? 'Docker'}…`, 'info');
		try {
			await this.api.startDocker();
		} catch (err) {
			showToast(`Couldn't start: ${(err as Error).message}`, 'error');
			this.docker.setStartingDocker(false);
		}
		// Leave the spinner until the next status update flips dockerConnected true.
	}

	// ── Images ──────────────────────────────────────────────────────────────

	async pullImage(image: string): Promise<void> {
		showToast(`Pulling ${image}…`, 'info');
		try {
			await this.api.pullImage(image);
			await this.reloadImages();
		} catch {
			/* surfaced via onPullProgress */
		}
	}

	/** Re-pull an image's tag to fetch the latest build. */
	async updateImage(tag: string): Promise<void> {
		showToast(`Updating ${tag}…`, 'info');
		try {
			await this.api.pullImage(tag);
			await this.reloadImages();
			showToast(`${tag} is up to date`, 'success');
		} catch (err) {
			showToast(`Update failed: ${(err as Error).message}`, 'error');
		}
	}

	async removeImage(id: string): Promise<void> {
		try {
			await this.api.removeImage(id);
			await this.reloadImages();
			showToast('Image removed', 'success');
		} catch (err) {
			showToast(`Remove failed: ${(err as Error).message}`, 'error');
		}
	}

	// ── Domains ─────────────────────────────────────────────────────────────

	async addDomain(domain: string): Promise<void> {
		try {
			const result = await this.api.addDomain(domain);
			this.docker.setDomains(result.domains);
			await Promise.all([this.reloadServices(), this.reloadStatus()]);
			showToast(`Added *.${domain}`, 'success');
			if (result.warning) showToast(result.warning, 'info');
		} catch (err) {
			showToast(ipcErrorMessage(err), 'error');
		}
	}

	async removeDomain(domain: string): Promise<void> {
		this.docker.setDomains(await this.api.removeDomain(domain));
		await Promise.all([this.reloadServices(), this.reloadStatus()]);
		showToast(`Removed *.${domain}`, 'info');
	}

	async setPrimaryDomain(domain: string): Promise<void> {
		this.docker.setDomains(await this.api.setPrimaryDomain(domain));
		await Promise.all([this.reloadServices(), this.reloadStatus()]);
		showToast(`*.${domain} is now primary`, 'success');
	}

	async setContainerDomains(name: string, domains: string[]): Promise<void> {
		await this.api.setContainerDomains(name, domains);
		await this.reloadServices();
	}

	// ── Privileged daemon ───────────────────────────────────────────────────

	/** Enable the daemon — shows the transient "Starting daemon…" pill state. */
	async enableDaemon(): Promise<void> {
		this.docker.setDaemonBusy(true);
		try {
			this.docker.setDaemon(await this.api.daemonInstall());
			await Promise.all([this.reloadServices(), this.reloadStatus()]);
			if (this.docker.daemon()?.running) showToast('Envy is live — your URLs are now served.', 'success');
			// The proxy can lag the install by a beat — re-probe soon so the pill
			// flips to "URLs live" without waiting for the 15s poll.
			setTimeout(() => void this.reloadDaemon(), 3000);
		} catch (err) {
			showToast(`Could not enable: ${(err as Error).message}`, 'error');
		} finally {
			this.docker.setDaemonBusy(false);
		}
	}

	async disableDaemon(): Promise<void> {
		try {
			this.docker.setDaemon(await this.api.daemonUninstall());
			showToast('Envy daemon removed.', 'info');
		} catch (err) {
			showToast(`Could not disable: ${(err as Error).message}`, 'error');
		}
	}

	// ── App settings + updates ──────────────────────────────────────────────

	async loadAppSettings(): Promise<void> {
		try {
			this.appSettings.setSettings(await this.api.getAppSettings());
		} catch {
			/* keep defaults */
		}
	}

	async setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
		try {
			this.appSettings.setSettings(await this.api.setAppSetting(key, value));
		} catch (err) {
			showToast(`Couldn't save setting: ${(err as Error).message}`, 'error');
		}
	}

	/** Manual "Check for Updates" with inline status feedback. */
	async checkForUpdates(): Promise<void> {
		this.appSettings.setUpdateChecking(true);
		this.appSettings.setUpdateCheckMsg('');
		try {
			const result = await this.api.checkForUpdates();
			switch (result.status) {
				case 'available':
					this.appSettings.setUpdateCheckMsg(`Downloading v${result.version}…`);
					break;
				case 'current':
					this.appSettings.setUpdateCheckMsg("You're on the latest version.");
					break;
				case 'dev':
					this.appSettings.setUpdateCheckMsg('Updates are disabled in development.');
					break;
				case 'error':
					this.appSettings.setUpdateCheckMsg(`Check failed: ${result.error ?? 'unknown error'}`);
					break;
			}
		} finally {
			this.appSettings.setUpdateChecking(false);
		}
	}

	/** Quit + relaunch into the staged update (electron-updater quitAndInstall). */
	restartForUpdate(): void {
		this.api.quitAndInstall();
	}

	// ── Misc ────────────────────────────────────────────────────────────────

	openUrl(url: string): Promise<void> {
		return this.api.openExternal(url);
	}

	async copy(text: string): Promise<void> {
		await this.api.copyText(text);
		showToast('Copied', 'success');
	}
}

/**
 * Strip Electron's "Error invoking remote method 'x':" wrapper so validation
 * messages from the main process read cleanly in a toast.
 */
function ipcErrorMessage(err: unknown): string {
	return (err as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
