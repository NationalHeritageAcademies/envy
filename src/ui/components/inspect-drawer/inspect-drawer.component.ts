import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import type { ContainerDetail, LogLine, Route } from '../../../ipc/contract';
import { DockerStateService } from '../../store/docker-state.service';
import { EnvyFacade } from '../../store/envy.facade';
import { SERVICE_LABEL } from '../../store/model';
import { DRAWER_DEFAULT_WIDTH, DRAWER_MIN_WIDTH, UiStateService } from '../../store/ui-state.service';
import { parseAnsi, type AnsiLine } from '../../util/ansi';
import { ShellTermComponent } from '../shell-term/shell-term.component';
import { ButtonComponent, IconComponent, SpinnerComponent } from '../ui';

/** Cap on retained log lines, so a chatty container can't grow the DOM forever. */
const MAX_LOGS = 500;

/**
 * A log line ready to render: parsed once on arrival rather than on every
 * change detection, since lines arrive several times a second and the pane
 * holds up to MAX_LOGS of them.
 */
interface LogRow {
	/** Monotonic id — stable for @for tracking as the buffer trims from the front. */
	key: number;
	/** Fallback colour class, used for the parts the line doesn't colour itself. */
	cls: string;
	line: AnsiLine;
}

/** Space left for the sidebar when the drawer is expanded to "full" width. */
const SIDEBAR_CLEARANCE = 256;

/** Environment rows shown before truncating; long env lists dominate the pane. */
const MAX_ENV_ROWS = 40;

/**
 * Everything about one container: its URLs, domain assignment, live logs, an
 * interactive shell, and its environment/mounts/details — plus the same
 * lifecycle actions as its card.
 *
 * The drag-to-resize handle writes the width straight onto the drawer element
 * and only commits to the persisted signal on release. Re-rendering mid-drag
 * would destroy and rebuild the xterm terminal on the Shell tab, taking its
 * scrollback and the running shell with it.
 */
@Component({
	selector: 'envy-inspect-drawer',
	templateUrl: './inspect-drawer.component.html',
	styleUrls: ['./inspect-drawer.component.scss'],
	imports: [ButtonComponent, IconComponent, ShellTermComponent, SpinnerComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class InspectDrawerComponent implements OnInit {
	private readonly docker = inject(DockerStateService);
	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly destroyRef = inject(DestroyRef);
	protected readonly ui = inject(UiStateService);
	protected readonly facade = inject(EnvyFacade);

	protected readonly detail = signal<ContainerDetail | null>(null);
	protected readonly logs = signal<LogRow[]>([]);
	protected readonly drawerTab = this.ui.drawerTab;
	protected readonly inspectConfirm = this.ui.inspectConfirm;
	protected readonly domains = this.docker.domains;
	protected readonly maxEnvRows = MAX_ENV_ROWS;

	/** The container being inspected; null only while the drawer tears down. */
	protected readonly containerId = this.ui.inspect;

	protected readonly service = computed(() => {
		const id = this.ui.inspect();
		return id === null ? undefined : this.docker.services().find((s) => s.id === id);
	});

	protected readonly title = computed(() => {
		const service = this.service();
		return service?.labels[SERVICE_LABEL] ?? this.detail()?.name ?? this.ui.inspect() ?? '';
	});

	protected readonly running = computed(() => this.detail()?.running ?? this.service()?.running ?? false);

	/** Effective domains for the container, computed in the main process. */
	protected readonly activeDomains = computed(() => new Set(this.service()?.domains ?? []));

	/**
	 * The shell terminal as a 0/1-element list. The `@for` is tracked by
	 * container id, so pointing the drawer at a different container tears the
	 * old terminal down instead of feeding a second session into it.
	 */
	protected readonly shellKey = computed(() => {
		const id = this.ui.inspect();
		return id !== null && this.ui.drawerTab() === 'shell' && this.running() ? [id] : [];
	});

	private logUnsub: (() => void) | null = null;
	private lastRunning: boolean | null = null;
	private logKey = 0;

	constructor() {
		// The width lives in a CSS custom property on the host, never a template
		// binding: the drag handler writes the same property directly, and a
		// binding would be re-applied (snapping the drawer back mid-drag) by any
		// unrelated re-render — log lines arrive several times a second.
		effect(() => {
			this.host.nativeElement.style.setProperty('--ev-drawer-width', `${this.ui.drawerWidth()}px`);
		});

		// Watch container state: when the inspected container comes back up after
		// a restart, the old `docker logs --follow` stream has ended — re-attach
		// so the tail keeps flowing without reopening the drawer.
		effect(() => {
			const id = this.ui.inspect();
			const running = this.docker.services().find((s) => s.id === id)?.running ?? false;
			if (id === null) return;
			untracked(() => {
				if (running && this.lastRunning === false) {
					this.logs.set([]);
					this.subscribeLogStream(id);
					void this.loadDetail(id);
				}
				this.lastRunning = running;
			});
		});

		this.destroyRef.onDestroy(() => {
			this.logUnsub?.();
			this.logUnsub = null;
		});
	}

	ngOnInit(): void {
		const id = this.ui.inspect();
		if (id !== null) void this.load(id);
	}

	private async load(id: string): Promise<void> {
		this.logUnsub?.();
		this.logUnsub = null;
		this.detail.set(null);
		this.logs.set([]);
		await this.loadDetail(id);
		this.lastRunning = this.detail()?.running ?? null;
		this.subscribeLogStream(id);
	}

	private async loadDetail(id: string): Promise<void> {
		try {
			this.detail.set(await window.envy.inspectContainer(id));
		} catch {
			/* container vanished mid-inspect — the drawer keeps the last snapshot */
		}
	}

	private subscribeLogStream(id: string): void {
		this.logUnsub?.();
		this.logUnsub = window.envy.subscribeLogs(id, (line) => {
			const row = this.toRow(line);
			this.logs.update((current) => {
				const next = [...current, row];
				return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
			});
		});
	}

	private toRow(line: LogLine): LogRow {
		const parsed = parseAnsi(line.text);
		return { key: this.logKey++, cls: this.logClass(line, parsed), line: parsed };
	}

	protected clearLogs(): void {
		this.logs.set([]);
	}

	/**
	 * Colour for the parts of a line that don't colour themselves.
	 *
	 * When the line carries its own ANSI styling the tool has already said how
	 * it should look, so the stderr/keyword heuristic stands down rather than
	 * fighting it — plenty of CLIs (ng, vite, npm) write ordinary progress
	 * output to stderr, and painting all of that red buries the real errors.
	 */
	private logClass(line: LogLine, parsed: AnsiLine): string {
		if (parsed.styled) return 'lg';
		const text = parsed.text.toLowerCase();
		if (line.stream === 'stderr' || text.includes('error')) return 'lg err';
		if (text.includes('warn')) return 'lg warn';
		return 'lg info';
	}

	/** Leave the 232px sidebar (+ a little gap) visible even when fully expanded. */
	private maxWidth(): number {
		return window.innerWidth - SIDEBAR_CLEARANCE;
	}

	protected readonly isExpanded = computed(() => this.ui.drawerWidth() >= this.maxWidth() - 4);

	/** One-click expand to (nearly) full width, or collapse back to default. */
	protected toggleExpand(): void {
		this.ui.setDrawerWidth(this.isExpanded() ? DRAWER_DEFAULT_WIDTH : this.maxWidth());
	}

	/**
	 * Drag the left edge to any width. Updated imperatively on the element
	 * during the drag, then committed to the persisted signal on release.
	 */
	protected startResize(event: PointerEvent): void {
		event.preventDefault();
		const el = this.host.nativeElement.querySelector<HTMLElement>('.drawer');
		if (!el) return;

		const startX = event.clientX;
		const startWidth = el.getBoundingClientRect().width;
		const max = this.maxWidth();
		document.body.style.userSelect = 'none';

		const move = (e: PointerEvent): void => {
			const width = Math.min(max, Math.max(DRAWER_MIN_WIDTH, startWidth + (startX - e.clientX)));
			this.host.nativeElement.style.setProperty('--ev-drawer-width', `${width}px`);
		};
		const up = (): void => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			document.body.style.userSelect = '';
			this.ui.setDrawerWidth(el.getBoundingClientRect().width);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	protected toggleDomain(domain: string): void {
		const service = this.service();
		if (!service) return;
		const next = new Set(service.domains);
		if (next.has(domain)) next.delete(domain);
		else next.add(domain);
		if (next.size === 0) return; // keep at least one
		void this.facade.setContainerDomains(service.name, [...next]);
	}

	protected routeUrl(route: Route): string {
		return `https://${route.host}`;
	}

	/** A stopped container's URL isn't reachable, so the link is inert there. */
	protected openRoute(route: Route): void {
		if (this.running()) void this.facade.openUrl(this.routeUrl(route));
	}

	protected copyRoute(route: Route): void {
		void this.facade.copy(this.routeUrl(route));
	}

	protected portSummary(detail: ContainerDetail): string {
		return detail.ports.map((p) => `${p.host ? `${p.host}→` : ''}${p.container}/${p.type}`).join('  ') || '—';
	}
}
