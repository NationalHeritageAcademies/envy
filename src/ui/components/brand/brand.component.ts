import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The Envy brand mark — a glowing emerald eye ("green with envy"). Reproduced
 * from the design handoff: a soft accent halo, a radial-gradient iris, a dark
 * pupil, and a white catchlight, with a green drop-shadow glow.
 *
 * The gradient id is fixed rather than generated because exactly one mark
 * renders at a time (the sidebar); a second instance would reference the same
 * def, which is harmless since both want the identical gradient.
 */
@Component({
	selector: 'envy-brand',
	templateUrl: './brand.component.html',
	styleUrls: ['./brand.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class BrandComponent {
	readonly size = input<number>(30);
}
