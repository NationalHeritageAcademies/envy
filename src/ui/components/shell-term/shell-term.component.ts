import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

/** Delay before the post-boot cleanup pass; see the call site. */
const SETTLE_MS = 180;

/**
 * An interactive `docker exec` shell rendered with xterm.js.
 *
 * The template is deliberately empty — xterm manages its own DOM inside the
 * host element and re-renders must never disturb it. `containerId` is read once
 * in ngOnInit rather than through an effect: a shell session is bound to the
 * container it was opened against, so a change means a different terminal
 * entirely. The drawer enforces that by rendering this component inside an
 * `@for` tracked by container id, which destroys and recreates it.
 *
 * xterm's stylesheet is imported globally in ui/main.ts, not as a component
 * style: xterm builds its DOM imperatively after the view is created, so those
 * nodes never receive the attribute emulated encapsulation scopes rules by.
 */
@Component({
	selector: 'envy-shell-term',
	template: '',
	styleUrls: ['./shell-term.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShellTermComponent implements OnInit, OnDestroy {
	readonly containerId = input.required<string>();

	private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

	private term: Terminal | null = null;
	private fit: FitAddon | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private sessionId: string | null = null;
	private offData: (() => void) | null = null;
	private offExit: (() => void) | null = null;
	private disposed = false;

	ngOnInit(): void {
		void this.boot(this.containerId());
	}

	private async boot(id: string): Promise<void> {
		// Wait for Fira Code to load BEFORE xterm measures the glyph cell —
		// opening against the fallback font sizes the grid wrong and the first
		// paint is garbled (misaligned rows / box artifacts).
		try {
			await document.fonts.ready;
		} catch {
			/* font loading API unavailable — fall through with the fallback metrics */
		}
		// The drawer can close (or switch tabs) during that await.
		if (this.disposed) return;

		const term = new Terminal({
			fontFamily: "'Fira Code', ui-monospace, monospace",
			fontSize: 12,
			lineHeight: 1.2,
			cursorBlink: true,
			scrollback: 2000,
			theme: { background: '#0e1211', foreground: '#e9ede9', cursor: '#34d399', selectionBackground: 'rgba(52,211,153,0.25)' }
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(this.host.nativeElement);
		fit.fit();
		this.term = term;
		this.fit = fit;

		// Start the pty at the already-fitted size so it never needs an immediate
		// resize (a resize sends SIGWINCH, which makes the shell redraw its
		// prompt → a duplicate prompt on first open).
		let lastCols = term.cols;
		let lastRows = term.rows;
		const { sessionId } = await window.envy.execStart(id, { cols: lastCols, rows: lastRows });
		if (this.disposed) {
			window.envy.execStop(sessionId);
			return;
		}
		this.sessionId = sessionId;

		this.offData = window.envy.onExecData((chunk) => {
			// Bytes arrive base64-encoded; decode to raw bytes so escape sequences
			// are written to xterm exactly as the shell emitted them.
			if (chunk.sessionId === sessionId) {
				term.write(Uint8Array.from(atob(chunk.data), (ch) => ch.charCodeAt(0)));
			}
		});
		this.offExit = window.envy.onExecExit((sid) => {
			if (sid === sessionId) term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
		});
		term.onData((data) => window.envy.execWrite(sessionId, data));

		// Wipe any initial first-paint artifacts once the prompt has arrived,
		// leaving a clean prompt at the top of the viewport.
		setTimeout(() => {
			this.term?.clear();
			this.fit?.fit();
		}, SETTLE_MS);

		// Refit on real size changes only — resizing to the same dimensions would
		// needlessly poke the shell into reprinting its prompt.
		this.resizeObserver = new ResizeObserver(() => {
			fit.fit();
			if (this.sessionId && (term.cols !== lastCols || term.rows !== lastRows)) {
				lastCols = term.cols;
				lastRows = term.rows;
				window.envy.execResize(this.sessionId, { cols: lastCols, rows: lastRows });
			}
		});
		this.resizeObserver.observe(this.host.nativeElement);
	}

	ngOnDestroy(): void {
		this.disposed = true;
		this.resizeObserver?.disconnect();
		if (this.sessionId) window.envy.execStop(this.sessionId);
		this.offData?.();
		this.offExit?.();
		this.term?.dispose();
		this.resizeObserver = null;
		this.sessionId = null;
		this.term = null;
		this.fit = null;
	}
}
