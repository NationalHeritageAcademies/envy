import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * On/off switch. The visible track and knob are decoration over a real
 * `<input type="checkbox">`, which keeps keyboard activation, the checked
 * ARIA state and label association working without re-implementing any of it.
 *
 * Controlled: `checked` is an input and the component never flips it locally —
 * the owner reacts to `checkedChange` and pushes the new value back. Settings
 * persist through IPC, so a toggle that moved before the write succeeded would
 * be lying about the stored state.
 */
@Component({
	selector: 'ev-toggle',
	templateUrl: './toggle.component.html',
	styleUrls: ['./toggle.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToggleComponent {
	readonly checked = input<boolean>(false);
	readonly disabled = input<boolean>(false);
	readonly ariaLabel = input<string>('');

	readonly checkedChange = output<boolean>();

	protected onChange(event: Event): void {
		this.checkedChange.emit((event.target as HTMLInputElement).checked);
	}
}
