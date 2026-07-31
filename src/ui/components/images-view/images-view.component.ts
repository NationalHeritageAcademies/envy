import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import type { ImageSummary } from '../../../ipc/contract';
import { DockerStateService } from '../../store/docker-state.service';
import { EnvyFacade } from '../../store/envy.facade';
import { UiStateService } from '../../store/ui-state.service';
import { inputValue } from '../../util/dom-events';
import { ButtonComponent, IconComponent, SpinnerComponent } from '../ui';

/** An image with the display fields the row template needs precomputed. */
interface ImageRow {
	image: ImageSummary;
	tag: string;
	name: string;
	version: string;
	inUse: boolean;
	size: string;
	age: string;
	/** Untagged (dangling) images can't be re-pulled or run from. */
	runnable: boolean;
}

function sizeLabel(bytes: number): string {
	return bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function ageLabel(createdSec: number): string {
	const days = Math.floor((Date.now() / 1000 - createdSec) / 86400);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 30) return `${days}d ago`;
	if (days < 365) return `${Math.floor(days / 30)}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}

/** Local images: pull new ones, filter, run, re-pull, remove. */
@Component({
	selector: 'envy-images-view',
	templateUrl: './images-view.component.html',
	styleUrls: ['./images-view.component.scss'],
	imports: [ButtonComponent, IconComponent, SpinnerComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImagesViewComponent implements OnInit {
	private readonly docker = inject(DockerStateService);
	protected readonly ui = inject(UiStateService);
	protected readonly facade = inject(EnvyFacade);

	protected readonly loading = this.docker.loading;
	protected readonly draft = signal('');
	protected readonly filter = signal('');

	protected readonly rows = computed<ImageRow[]>(() => {
		const used = new Set(this.docker.services().map((s) => s.image));
		const query = this.filter().toLowerCase();
		return this.docker
			.images()
			.filter((image) => (image.tags[0] ?? '').toLowerCase().includes(query))
			.map((image) => {
				const tag = image.tags[0] ?? '<none>:<none>';
				const [name, version] = tag.split(':');
				return {
					image,
					tag,
					name: name ?? tag,
					version: version ?? '',
					inUse: used.has(image.tags[0] ?? ''),
					size: sizeLabel(image.size),
					age: ageLabel(image.created),
					runnable: !!image.tags[0] && !image.tags[0].startsWith('<none>')
				};
			});
	});

	ngOnInit(): void {
		// Refresh on every tab open so images pulled outside Envy (CLI, compose)
		// show up without a restart.
		this.facade.reloadImages().catch(() => {
			/* Docker offline — keep the last list */
		});
	}

	protected pull(): void {
		const value = this.draft().trim();
		if (!value) return;
		void this.facade.pullImage(value);
		this.draft.set('');
	}

	protected onDraftInput(event: Event): void {
		this.draft.set(inputValue(event));
	}

	protected onFilterInput(event: Event): void {
		this.filter.set(inputValue(event));
	}
}
