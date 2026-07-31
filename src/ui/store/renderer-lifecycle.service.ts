import { Injectable, inject } from '@angular/core';
import { showToast } from '../components/toast';
import { AppSettingsService } from './app-settings.service';
import { DockerStateService } from './docker-state.service';
import { EnvyFacade } from './envy.facade';
import { ThemeService } from './theme.service';
import { UiStateService } from './ui-state.service';

/** How often to re-probe the daemon; see the comment on the poll below. */
const DAEMON_POLL_MS = 15_000;

/**
 * Renderer-side boot glue — the Angular home for what the old ui/main.ts
 * `bootstrap()` did: load the initial data, then wire the main process's push
 * events into store updates.
 *
 * start() is invoked once from the app initializer (see app.config.ts); the
 * data load itself is deliberately not awaited so first paint isn't blocked on
 * IPC — the services view renders its shimmer skeleton while this runs.
 */
@Injectable({ providedIn: 'root' })
export class RendererLifecycleService {
	private readonly facade = inject(EnvyFacade);
	private readonly docker = inject(DockerStateService);
	private readonly ui = inject(UiStateService);
	private readonly appSettings = inject(AppSettingsService);
	// Injected for its constructor effect, which puts data-theme on <html>.
	private readonly theme = inject(ThemeService);

	private started = false;

	start(): void {
		if (this.started) return;
		this.started = true;

		void this.bootstrap();
	}

	private async bootstrap(): Promise<void> {
		const api = window.envy;

		// Read the theme once so the effect that writes data-theme has run before
		// first paint (otherwise the first frame renders on the default palette).
		this.theme.theme();

		try {
			this.docker.setPlatform(await api.platform());
		} catch {
			/* default darwin */
		}
		try {
			this.docker.setProvider(await api.dockerProvider());
		} catch {
			/* ignore — the offline empty state degrades to "no provider detected" */
		}

		this.docker.setLoading(true);
		// allSettled, not all: when Docker is offline the container/image queries
		// reject, and we must still clear the loading state (otherwise the
		// skeleton shimmers forever instead of showing the offline message).
		await Promise.allSettled([
			this.facade.reloadStatus(),
			this.facade.reloadServices(),
			this.facade.reloadImages(),
			this.facade.reloadDomains(),
			this.facade.reloadDaemon()
		]);
		this.docker.setLoading(false);

		api.onServicesChanged(() => void this.facade.reloadServices());

		api.onStatusChanged((status) => {
			// Docker just came (back) up — the bootstrap queries may have run
			// against a dead engine, so re-fetch the lists that only load on demand.
			const reconnected = status.dockerConnected && !this.docker.status()?.dockerConnected;
			this.docker.setStatus(status);
			if (status.dockerConnected) this.docker.setStartingDocker(false);
			if (reconnected) {
				void Promise.allSettled([this.facade.reloadServices(), this.facade.reloadImages(), this.facade.reloadDomains()]);
			}
		});

		api.onPullProgress((event) => {
			if (event.done) {
				showToast(event.error ? `Pull failed: ${event.error}` : `Pulled ${event.image}`, event.error ? 'error' : 'success');
			}
		});

		// A newer Envy version has been downloaded in the background — surface
		// the "Restart to update" pill in the header.
		api.onUpdateDownloaded((info) => {
			this.appSettings.setUpdateReady(info.version);
			showToast(`Envy ${info.version} is ready — restart to update.`, 'info');
		});

		// The tray's "Settings…" item asks the renderer to open the Settings view.
		api.onOpenSettings(() => this.ui.setView('settings'));

		// App settings + version for the Settings view (non-blocking).
		void this.facade.loadAppSettings();
		api.appVersion()
			.then((version) => this.appSettings.setVersion(version))
			.catch(() => {
				/* ignore — the version line just stays blank */
			});

		// Daemon health is a live probe (launchctl + a TCP connect to the proxy
		// port), not a pushed event — re-poll so the header pill catches a proxy
		// that died mid-session instead of showing "URLs live" forever.
		setInterval(() => void this.facade.reloadDaemon(), DAEMON_POLL_MS);
	}
}
