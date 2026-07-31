import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AppSettingsService } from '../../store/app-settings.service';
import { EnvyFacade } from '../../store/envy.facade';
import { ButtonComponent, IconComponent, SpinnerComponent, ToggleComponent } from '../ui';

/** App preferences: background behaviour, login item, and manual update check. */
@Component({
	selector: 'envy-settings-view',
	templateUrl: './settings-view.component.html',
	styleUrls: ['./settings-view.component.scss'],
	imports: [ButtonComponent, IconComponent, SpinnerComponent, ToggleComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsViewComponent {
	private readonly appSettings = inject(AppSettingsService);
	protected readonly facade = inject(EnvyFacade);

	protected readonly settings = this.appSettings.settings;
	protected readonly version = this.appSettings.version;
	protected readonly updateChecking = this.appSettings.updateChecking;
	protected readonly updateCheckMsg = this.appSettings.updateCheckMsg;
}
