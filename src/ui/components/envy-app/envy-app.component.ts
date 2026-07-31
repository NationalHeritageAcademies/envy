import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppSettingsService } from '../../store/app-settings.service';
import { DockerStateService } from '../../store/docker-state.service';
import { EnvyFacade } from '../../store/envy.facade';
import type { View } from '../../store/model';
import { ThemeService } from '../../store/theme.service';
import { UiStateService } from '../../store/ui-state.service';
import { ActivityViewComponent } from '../activity-view/activity-view.component';
import { BrandComponent } from '../brand/brand.component';
import { DomainsViewComponent } from '../domains-view/domains-view.component';
import { ImagesViewComponent } from '../images-view/images-view.component';
import { InspectDrawerComponent } from '../inspect-drawer/inspect-drawer.component';
import { RunDialogComponent } from '../run-dialog/run-dialog.component';
import { ServicesViewComponent } from '../services-view/services-view.component';
import { SettingsViewComponent } from '../settings-view/settings-view.component';
import { ButtonComponent, IconComponent, SpinnerComponent } from '../ui';

const NAV: { id: View; label: string; icon: string }[] = [
	{ id: 'services', label: 'Services', icon: 'squares-four' },
	{ id: 'images', label: 'Images', icon: 'cube' },
	{ id: 'domains', label: 'Domains', icon: 'globe-simple' },
	{ id: 'activity', label: 'Activity', icon: 'pulse' }
];

const TITLE: Record<View, string> = {
	services: 'Services',
	images: 'Images',
	domains: 'Domains',
	activity: 'Activity Monitor',
	settings: 'Settings'
};

/**
 * The shell: sidebar nav on the left, header + the active view on the right,
 * with the inspect drawer and Run dialog layered on top.
 *
 * The header's daemon pill is the app's single most important status readout,
 * so it distinguishes four states rather than a simple on/off — see
 * `daemonState` for what each one means.
 */
@Component({
	selector: 'envy-app',
	templateUrl: './envy-app.component.html',
	styleUrls: ['./envy-app.component.scss'],
	imports: [
		ActivityViewComponent,
		BrandComponent,
		ButtonComponent,
		DomainsViewComponent,
		IconComponent,
		ImagesViewComponent,
		InspectDrawerComponent,
		RunDialogComponent,
		ServicesViewComponent,
		SettingsViewComponent,
		SpinnerComponent
	],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class EnvyAppComponent {
	private readonly docker = inject(DockerStateService);
	private readonly appSettings = inject(AppSettingsService);
	protected readonly ui = inject(UiStateService);
	protected readonly facade = inject(EnvyFacade);
	protected readonly themeService = inject(ThemeService);

	protected readonly nav = NAV;

	protected readonly view = this.ui.view;
	protected readonly inspect = this.ui.inspect;
	protected readonly theme = this.themeService.theme;
	protected readonly appVersion = this.appSettings.version;
	protected readonly updateReady = this.appSettings.updateReady;
	protected readonly daemon = this.docker.daemon;

	protected readonly isMac = computed(() => this.docker.platform() === 'darwin');
	protected readonly isWindows = computed(() => this.docker.platform() === 'win32');

	protected readonly title = computed(() => TITLE[this.ui.view()]);

	protected readonly subtitle = computed(() => {
		switch (this.ui.view()) {
			case 'services': {
				const list = this.docker.services();
				return `${list.filter((s) => s.running).length} of ${list.length} services running`;
			}
			case 'images':
				return `${this.docker.images().length} local images`;
			case 'domains': {
				const domains = this.docker.domains();
				return `${domains.length} domain${domains.length === 1 ? '' : 's'} served · *.${domains[0] ?? 'envy.local'}`;
			}
			case 'activity':
				return 'Live resource usage · updates every 1.5s';
			case 'settings':
				return 'App preferences · keep-running, login, updates';
		}
	});

	/**
	 * Which daemon pill to render:
	 *   offline  — Docker itself is unreachable, so daemon state is moot
	 *   starting — the install is mid-flight (one native auth prompt)
	 *   live     — installed, running, and the proxy port answered a probe
	 *   stalled  — running but nothing is listening; a daemon that broke
	 *              mid-reconfigure is "running" while serving nothing, and
	 *              claiming "URLs live" there sends users hunting the wrong bug
	 *   off      — not installed (or not running): offer to enable
	 */
	protected readonly daemonState = computed<'offline' | 'starting' | 'live' | 'stalled' | 'off'>(() => {
		const status = this.docker.status();
		if (status && !status.dockerConnected) return 'offline';
		if (this.docker.daemonBusy()) return 'starting';
		const daemon = this.docker.daemon();
		if (daemon?.installed && daemon.running) return daemon.proxyListening ? 'live' : 'stalled';
		return 'off';
	});

	protected setView(view: View): void {
		this.ui.setView(view);
	}
}
