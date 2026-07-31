/**
 * Last-resort renderer error net. Must be the FIRST import of ui/main.ts so it
 * evaluates before the Angular bootstrap and component imports — a throw in any
 * later module (e.g. a packaged-build resolution glitch) then surfaces here
 * instead of leaving the window on its bare backgroundColor: a silent black
 * pane (see docs/plans/blank-screen-recovery.md). The console.error also
 * reaches the main-process log via its console-message hook.
 */
export function fail(what: string, err: unknown): void {
	console.error(`Envy ${what} failed:`, err);
	// Only take over the page when the app never mounted. Angular renders the
	// shell inside <envy-root>, so a populated root means the UI is up and a
	// stray rejected promise mid-session must not wipe a working screen.
	if (document.querySelector('envy-root')?.firstElementChild) return;
	document.body.textContent = '';
	const box = document.createElement('div');
	box.style.cssText = 'color:#e9ede9;font:14px system-ui;padding:2rem';
	box.append('Envy hit an error while loading. ');
	const reload = document.createElement('a');
	reload.href = '#';
	reload.textContent = 'Reload';
	reload.style.color = '#4ade80';
	reload.addEventListener('click', (e) => {
		e.preventDefault();
		location.reload();
	});
	box.append(reload);
	document.body.append(box);
}

window.addEventListener('error', (e) => fail('render', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fail('render', e.reason));
