import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { RunOptions } from '../../../ipc/contract';
import { DockerStateService } from '../../store/docker-state.service';
import { EnvyFacade } from '../../store/envy.facade';
import { UiStateService } from '../../store/ui-state.service';
import { inputValue } from '../../util/dom-events';
import { ButtonComponent, DialogComponent } from '../ui';

/** Parse "5432:5432, 8080:80" into port pairs, dropping anything unparseable. */
function parsePorts(raw: string): { host: number; container: number }[] {
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((pair) => {
			const parts = pair.split(':').map((n) => Number.parseInt(n.trim(), 10));
			const host = parts[0];
			return { host, container: parts[1] ?? host };
		})
		.filter((p): p is { host: number; container: number } => Number.isFinite(p.host) && Number.isFinite(p.container));
}

/**
 * Parse one "source:target" mount per line. Split on the LAST colon so Windows
 * paths ("C:\data:/in/container") keep their drive letter.
 */
function parseVolumes(raw: string): { source: string; target: string }[] {
	return raw
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((line) => {
			const idx = line.lastIndexOf(':');
			return idx > 0 ? { source: line.slice(0, idx), target: line.slice(idx + 1) } : null;
		})
		.filter((v): v is { source: string; target: string } => v !== null);
}

/** A friendly `docker run`: image, name, hostname, domains, ports, env, volumes. */
@Component({
	selector: 'envy-run-dialog',
	templateUrl: './run-dialog.component.html',
	styleUrls: ['./run-dialog.component.scss'],
	imports: [ButtonComponent, DialogComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class RunDialogComponent {
	private readonly docker = inject(DockerStateService);
	private readonly facade = inject(EnvyFacade);
	protected readonly ui = inject(UiStateService);

	private readonly dialog = viewChild.required(DialogComponent);

	protected readonly domains = this.docker.domains;
	protected readonly image = signal('');
	protected readonly name = signal('');
	protected readonly hostname = signal('');
	protected readonly ports = signal('');
	protected readonly env = signal('');
	protected readonly volumes = signal('');
	protected readonly selectedDomains = signal<ReadonlySet<string>>(new Set());
	protected readonly busy = signal(false);

	protected readonly primary = computed(() => this.docker.domains()[0] ?? 'envy');

	constructor() {
		// Drive the native <dialog> from the shared signal, resetting the form on
		// each open so a cancelled run doesn't leak into the next one.
		effect(() => {
			const open = this.ui.runOpen();
			if (open) this.reset();
			if (open) this.dialog().open();
			else this.dialog().close();
		});
	}

	private reset(): void {
		this.image.set(this.ui.consumeRunPrefill());
		this.name.set('');
		this.hostname.set('');
		this.ports.set('');
		this.env.set('');
		this.volumes.set('');
		// Primary domain preselected — the default every container gets.
		this.selectedDomains.set(new Set(this.docker.domains().slice(0, 1)));
	}

	protected toggleDomain(domain: string): void {
		const next = new Set(this.selectedDomains());
		if (next.has(domain)) next.delete(domain);
		else next.add(domain);
		if (next.size === 0) return; // keep at least one
		this.selectedDomains.set(next);
	}

	protected onInput(target: 'image' | 'name' | 'hostname' | 'ports' | 'env' | 'volumes', event: Event): void {
		this[target].set(inputValue(event));
	}

	protected cancel(): void {
		this.ui.closeRun();
	}

	private parse(): RunOptions {
		const env = this.env()
			.split('\n')
			.map((s) => s.trim())
			.filter((line) => line.includes('='));

		const labels: Record<string, string> = {};
		const hostname = this.hostname().trim();
		if (hostname) labels['envy.host'] = hostname;

		// Only set envy.domains when it differs from the default (primary only) —
		// an explicit label locks the container's domains against later UI edits.
		const selected = [...this.selectedDomains()];
		const primary = this.docker.domains()[0];
		if (selected.length && !(selected.length === 1 && selected[0] === primary)) {
			labels['envy.domains'] = selected.join(',');
		}

		return {
			image: this.image().trim(),
			name: this.name().trim() || undefined,
			ports: parsePorts(this.ports()),
			env: env.length ? env : undefined,
			volumes: parseVolumes(this.volumes()),
			labels: Object.keys(labels).length ? labels : undefined
		};
	}

	protected async submit(): Promise<void> {
		if (!this.image().trim()) return;
		this.busy.set(true);
		try {
			await this.facade.runContainer(this.parse());
			this.ui.closeRun();
		} catch {
			/* toast shown by the facade; leave the form up so it can be retried */
		} finally {
			this.busy.set(false);
		}
	}
}
