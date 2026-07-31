import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import type { StatSample } from '../../../ipc/contract';
import { DockerStateService } from '../../store/docker-state.service';
import { PROJECT_LABEL, SERVICE_LABEL, STANDALONE } from '../../store/model';
import { IconComponent } from '../ui';

/** Sparkline history length — ~42s of samples at the 1.5s stats interval. */
const HIST = 28;

const STORAGE_COLLAPSED = 'envy:activityCollapsed';

/** Sparkline geometry: tiles draw into a 200x40 viewBox, rows into 34x14. */
const TILE_W = 200;
const TILE_H = 40;
const ROW_W = 34;
const ROW_H = 14;

interface Totals {
	cpu: number;
	mem: number;
	net: number;
	disk: number;
}

interface Tile {
	label: string;
	value: string;
	points: string;
	color: string;
}

interface ActivityRow {
	id: string;
	name: string;
	running: boolean;
	cpu: string;
	mem: string;
	net: string;
	disk: string;
	points: string;
}

interface ActivityGroup {
	project: string;
	running: number;
	total: number;
	cpu: string;
	mem: string;
	net: string;
	disk: string;
	rows: ActivityRow[];
}

const ZERO: Totals = { cpu: 0, mem: 0, net: 0, disk: 0 };

function kbps(bytesPerSec: number): string {
	if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
	return `${(bytesPerSec / 1e3).toFixed(1)} KB/s`;
}

function mem(bytes: number): string {
	if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
	return `${Math.round(bytes / 1e6)} MB`;
}

function sum(samples: StatSample[]): Totals {
	return samples.reduce((acc, s) => ({ cpu: acc.cpu + s.cpu, mem: acc.mem + s.memBytes, net: acc.net + s.netRate, disk: acc.disk + s.diskRate }), {
		...ZERO
	});
}

/** Append to a bounded history, returning a new array (signals need identity). */
function push(history: number[], value: number): number[] {
	const next = [...history, value];
	return next.length > HIST ? next.slice(next.length - HIST) : next;
}

/** Build an SVG polyline `points` string from a history array, fit to w×h. */
function spark(history: number[], w: number, h: number): string {
	if (history.length < 2) return `0,${h} ${w},${h}`;
	const max = Math.max(...history, 0.0001);
	const step = w / (HIST - 1);
	return history.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
}

function loadCollapsed(): Record<string, boolean> {
	try {
		return JSON.parse(globalThis.localStorage?.getItem(STORAGE_COLLAPSED) ?? '{}') as Record<string, boolean>;
	} catch {
		return {};
	}
}

/**
 * Live resource monitor fed by the main process's `docker stats` stream.
 *
 * History is kept in signals holding fresh arrays rather than mutated in place:
 * under zoneless change detection an in-place `push` is invisible to the
 * template, so the sparklines would freeze at whatever they showed on the first
 * sample.
 */
@Component({
	selector: 'envy-activity-view',
	templateUrl: './activity-view.component.html',
	styleUrls: ['./activity-view.component.scss'],
	imports: [IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivityViewComponent implements OnInit {
	private readonly docker = inject(DockerStateService);
	private readonly destroyRef = inject(DestroyRef);

	private readonly samples = signal<StatSample[]>([]);
	private readonly history = signal<{ cpu: number[]; mem: number[]; net: number[]; disk: number[] }>({ cpu: [], mem: [], net: [], disk: [] });
	private readonly cpuById = signal<Record<string, number[]>>({});
	private readonly collapsed = signal<Record<string, boolean>>(loadCollapsed());

	protected readonly tiles = computed<Tile[]>(() => {
		const totals = sum(this.samples());
		const history = this.history();
		return [
			{ label: 'CPU', value: `${totals.cpu.toFixed(1)}%`, points: spark(history.cpu, TILE_W, TILE_H), color: 'var(--ev-accent)' },
			{ label: 'Memory', value: mem(totals.mem), points: spark(history.mem, TILE_W, TILE_H), color: '#5aa9ff' },
			{ label: 'Network', value: kbps(totals.net), points: spark(history.net, TILE_W, TILE_H), color: '#c084fc' },
			{ label: 'Disk', value: kbps(totals.disk), points: spark(history.disk, TILE_W, TILE_H), color: '#e3b341' }
		];
	});

	/**
	 * Rows come from the service list (so stopped containers still appear) and
	 * are filled in from the latest stats sample keyed by container id.
	 */
	protected readonly groups = computed<ActivityGroup[]>(() => {
		const byId = new Map(this.samples().map((s) => [s.id, s]));
		const cpuById = this.cpuById();
		const byProject = new Map<string, ActivityRow[]>();
		const groupSamples = new Map<string, StatSample[]>();

		for (const service of this.docker.services()) {
			const project = service.labels[PROJECT_LABEL] ?? STANDALONE;
			const sample = byId.get(service.id);
			const running = sample?.running === true;
			const rows = byProject.get(project) ?? [];
			rows.push({
				id: service.id,
				name: service.labels[SERVICE_LABEL] ?? service.name,
				running,
				cpu: running ? `${(sample?.cpu ?? 0).toFixed(1)}%` : '—',
				mem: running ? mem(sample?.memBytes ?? 0) : '—',
				net: running ? kbps(sample?.netRate ?? 0) : '—',
				disk: running ? kbps(sample?.diskRate ?? 0) : '—',
				points: spark(cpuById[service.id] ?? [], ROW_W, ROW_H)
			});
			byProject.set(project, rows);
			if (sample) groupSamples.set(project, [...(groupSamples.get(project) ?? []), sample]);
		}

		return [...byProject.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([project, rows]) => {
				const totals = sum(groupSamples.get(project) ?? []);
				return {
					project,
					running: rows.filter((r) => r.running).length,
					total: rows.length,
					cpu: `${totals.cpu.toFixed(1)}%`,
					mem: mem(totals.mem),
					net: kbps(totals.net),
					disk: kbps(totals.disk),
					rows
				};
			});
	});

	ngOnInit(): void {
		const stop = window.envy.subscribeStats((samples) => {
			this.samples.set(samples);
			const totals = sum(samples);
			this.history.update((h) => ({
				cpu: push(h.cpu, totals.cpu),
				mem: push(h.mem, totals.mem),
				net: push(h.net, totals.net),
				disk: push(h.disk, totals.disk)
			}));
			this.cpuById.update((current) => {
				const next = { ...current };
				for (const sample of samples) next[sample.id] = push(next[sample.id] ?? [], sample.cpu);
				return next;
			});
		});
		this.destroyRef.onDestroy(stop);
	}

	protected isCollapsed(project: string): boolean {
		return this.collapsed()[project] === true;
	}

	protected toggle(project: string): void {
		this.collapsed.update((current) => {
			const next = { ...current, [project]: !current[project] };
			try {
				globalThis.localStorage?.setItem(STORAGE_COLLAPSED, JSON.stringify(next));
			} catch {
				/* localStorage unavailable */
			}
			return next;
		});
	}
}
