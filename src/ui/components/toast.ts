// A tiny, dependency-free toast. Uses an aria-live region so screen readers
// announce messages without stealing focus (WCAG). Auto-dismisses in 3.5s.
//
// Deliberately framework-free (no Angular dependency) so it stays drop-in
// usable from anywhere in the renderer — including the facade, which reports
// action outcomes from outside any component's injection context.

export type ToastKind = 'info' | 'success' | 'error';

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
	if (container) return container;
	const el = document.createElement('div');
	el.setAttribute('aria-live', 'polite');
	el.style.cssText = [
		'position:fixed',
		'bottom:20px',
		'right:20px',
		'display:flex',
		'flex-direction:column',
		'gap:8px',
		'z-index:1000',
		'pointer-events:none'
	].join(';');
	document.body.appendChild(el);
	container = el;
	return el;
}

const ACCENT: Record<ToastKind, string> = {
	info: 'var(--ev-accent-2)',
	success: 'var(--ev-accent)',
	error: 'var(--ev-danger)'
};

export function showToast(message: string, kind: ToastKind = 'info'): void {
	const host = ensureContainer();
	const toast = document.createElement('div');
	toast.textContent = message;
	toast.style.cssText = [
		'pointer-events:auto',
		'min-width:200px',
		'max-width:380px',
		'padding:10px 14px',
		'border-radius:var(--ev-radius-lg)',
		'background:var(--ev-surface)',
		`border:1px solid ${ACCENT[kind]}`,
		`border-left:3px solid ${ACCENT[kind]}`,
		'color:var(--ev-text)',
		'font-family:var(--ev-font-sans)',
		'font-size:13px',
		'box-shadow:var(--ev-shadow-lg)',
		'opacity:0',
		'transform:translateY(6px)',
		'transition:opacity .18s ease-out, transform .18s ease-out'
	].join(';');
	host.appendChild(toast);

	requestAnimationFrame(() => {
		toast.style.opacity = '1';
		toast.style.transform = 'translateY(0)';
	});

	setTimeout(() => {
		toast.style.opacity = '0';
		toast.style.transform = 'translateY(6px)';
		setTimeout(() => toast.remove(), 200);
	}, 3500);
}
