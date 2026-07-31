import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EnvyAppComponent } from '../components/envy-app/envy-app.component';

/**
 * Root of the renderer. Deliberately thin — it exists so `index.html` has a
 * single stable mount point (`<envy-root>`) and so the real shell
 * (`<envy-app>`) can be swapped or wrapped without touching bootstrap.
 */
@Component({
	selector: 'envy-root',
	template: '<envy-app />',
	imports: [EnvyAppComponent],
	changeDetection: ChangeDetectionStrategy.OnPush
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Angular components are classes even when template-only
export class AppComponent {}
