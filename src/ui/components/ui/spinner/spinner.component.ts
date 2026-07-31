import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type SpinnerSize = 'sm' | 'md';

/** Indeterminate busy indicator — a rotating arc in the current text color. */
@Component({
	selector: 'ev-spinner',
	template: '',
	styleUrls: ['./spinner.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		'[attr.data-size]': 'size()',
		'role': 'status',
		'aria-label': 'Loading'
	}
})
export class SpinnerComponent {
	readonly size = input<SpinnerSize>('md');
}
