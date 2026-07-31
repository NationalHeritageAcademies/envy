import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { RendererLifecycleService } from '../store/renderer-lifecycle.service';

/**
 * Renderer-wide providers.
 *
 * Zoneless: every piece of renderer state is already a signal (see
 * `src/ui/store`), so there is nothing for zone.js to usefully patch. Dropping
 * it also keeps xterm's own async work (the exec stream, its ResizeObserver)
 * out of a zone, which is a known source of spurious change-detection churn in
 * terminal-heavy UIs.
 *
 * The initializer starts the renderer lifecycle (data load, push-event wiring)
 * without awaiting it — first paint should not block on IPC.
 */
export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideZonelessChangeDetection(),
		provideAppInitializer(() => {
			inject(RendererLifecycleService).start();
		})
	]
};
