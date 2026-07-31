import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { Route, ServiceView } from '../../../ipc/contract';
import { DockerStateService } from '../../store/docker-state.service';
import { EnvyFacade } from '../../store/envy.facade';
import { PROJECT_LABEL, SERVICE_LABEL, STANDALONE, type BusyKind, type ServiceGroup } from '../../store/model';
import { UiStateService } from '../../store/ui-state.service';
import { ButtonComponent, IconComponent, SpinnerComponent } from '../ui';

const BUSY_LABEL: Record<BusyKind, string> = {
	start: 'Starting…',
	stop: 'Stopping…',
	restart: 'Restarting…',
	remove: 'Removing…'
};

/** Fallback when the detected provider has no install URL of its own. */
const DOCKER_DESKTOP_URL = 'https://www.docker.com/products/docker-desktop/';

/** Placeholder rows for the first-boot shimmer skeleton. */
const SKELETON_GROUPS = [0, 1];
const SKELETON_CARDS = [0, 1, 2, 3];

function portLabel(service: ServiceView): string {
	const published = service.ports.find((p) => p.publicPort);
	if (published) return `:${published.publicPort}→${published.privatePort}`;
	const exposed = service.ports.find((p) => p.type === 'tcp');
	return exposed ? `:${exposed.privatePort}` : '';
}

/**
 * Containers grouped by Compose project, projects first (alphabetical) and
 * standalone containers in a trailing bucket.
 */
function groupServices(list: ServiceView[]): ServiceGroup<ServiceView>[] {
	const byProject = new Map<string, ServiceView[]>();
	const standalone: ServiceView[] = [];
	for (const service of list) {
		const project = service.labels[PROJECT_LABEL];
		if (project) byProject.set(project, [...(byProject.get(project) ?? []), service]);
		else standalone.push(service);
	}
	const groups = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([project, services]) => ({ project, standalone: false, services }));
	if (standalone.length) groups.push({ project: STANDALONE, standalone: true, services: standalone });
	return groups;
}

/**
 * The main screen: every container Envy can see, grouped by Compose project,
 * each card showing its URLs and the actions that apply to its current state.
 *
 * The empty state does real work — with no containers the most likely cause is
 * that Docker itself isn't reachable, so it branches on engine status to offer
 * "start your provider" or "install Docker" instead of an unhelpful
 * "nothing here".
 */
@Component({
	selector: 'envy-services-view',
	templateUrl: './services-view.component.html',
	styleUrls: ['./services-view.component.scss'],
	imports: [ButtonComponent, IconComponent, SpinnerComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServicesViewComponent {
	private readonly docker = inject(DockerStateService);
	protected readonly ui = inject(UiStateService);
	protected readonly facade = inject(EnvyFacade);

	protected readonly loading = this.docker.loading;
	protected readonly services = this.docker.services;
	protected readonly busy = this.docker.busy;
	protected readonly removeConfirm = this.docker.removeConfirm;
	protected readonly provider = this.docker.provider;
	protected readonly startingDocker = this.docker.startingDocker;

	protected readonly busyLabel = BUSY_LABEL;
	protected readonly skeletonGroups = SKELETON_GROUPS;
	protected readonly skeletonCards = SKELETON_CARDS;

	protected readonly groups = computed(() => groupServices(this.docker.services()));

	/** Engine explicitly reported not connected — distinct from "not asked yet". */
	protected readonly dockerOffline = computed(() => this.docker.status()?.dockerConnected === false);

	protected readonly dockerMissing = computed(() => this.docker.provider()?.installed === false);

	protected readonly installUrl = computed(() => this.docker.provider()?.installUrl ?? DOCKER_DESKTOP_URL);

	protected isCollapsed(project: string): boolean {
		return this.ui.collapsedGroups()[project] === true;
	}

	protected runningCount(group: ServiceGroup<ServiceView>): number {
		return group.services.filter((s) => s.running).length;
	}

	/**
	 * "Start all" when nothing in the group runs, "Stop all" otherwise — the
	 * single button covers both because a half-running Compose project almost
	 * always wants to be brought fully down, not partly up.
	 */
	protected toggleGroup(group: ServiceGroup<ServiceView>): void {
		const anyRunning = this.runningCount(group) > 0;
		for (const service of group.services) {
			if (anyRunning && service.running) void this.facade.stopService(service.id);
			else if (!anyRunning && !service.running) void this.facade.startService(service.id);
		}
	}

	protected cardTitle(service: ServiceView, grouped: boolean): string {
		return grouped ? (service.labels[SERVICE_LABEL] ?? service.name) : service.name;
	}

	protected metaLine(service: ServiceView): string {
		const port = portLabel(service);
		return port ? `${service.image} · ${port}` : service.image;
	}

	protected routeUrl(route: Route): string {
		return `https://${route.host}`;
	}

	/** A stopped container's URL isn't reachable, so the link is inert there. */
	protected openRoute(service: ServiceView, route: Route): void {
		if (service.running) void this.facade.openUrl(this.routeUrl(route));
	}

	protected copyRoute(route: Route): void {
		void this.facade.copy(this.routeUrl(route));
	}

	/** Whether a route's host belongs to a configured Envy domain or a custom one. */
	protected urlTag(host: string): 'local' | 'custom' {
		return this.docker.domains().some((d) => host === d || host.endsWith(`.${d}`)) ? 'local' : 'custom';
	}

	/**
	 * A running container with an exposed-but-unpublished port has no URL, and
	 * on Docker Desktop that is not fixable by Envy: container IPs aren't
	 * host-routable there, so the user has to publish the port themselves.
	 */
	protected needsPublishedPort(service: ServiceView): boolean {
		const hasExposed = service.ports.some((p) => p.type === 'tcp');
		const routable = this.docker.status()?.containerIpsRoutable ?? true;
		return hasExposed && !routable;
	}

	protected domainSummary(service: ServiceView): string {
		return service.domains.length === 1 ? (service.domains[0] ?? '') : `${service.domains.length} domains`;
	}
}
