import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DockerStateService } from '../../store/docker-state.service';
import { EnvyFacade } from '../../store/envy.facade';
import { inputValue } from '../../util/dom-events';
import { ButtonComponent, IconComponent } from '../ui';

/**
 * The configured domain suffixes Envy serves. The first entry is the primary:
 * containers that don't pick their own domains get a URL under it, which is
 * why "Make primary" reorders rather than setting a flag.
 */
@Component({
	selector: 'envy-domains-view',
	templateUrl: './domains-view.component.html',
	styleUrls: ['./domains-view.component.scss'],
	imports: [ButtonComponent, IconComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class DomainsViewComponent {
	private readonly docker = inject(DockerStateService);
	protected readonly facade = inject(EnvyFacade);

	protected readonly domains = this.docker.domains;
	protected readonly draft = signal('');

	protected readonly primary = computed(() => this.docker.domains()[0] ?? 'envy');

	protected add(): void {
		const value = this.draft().trim();
		if (!value) return;
		void this.facade.addDomain(value);
		this.draft.set('');
	}

	protected onDraftInput(event: Event): void {
		this.draft.set(inputValue(event));
	}
}
