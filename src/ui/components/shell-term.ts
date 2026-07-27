import { MelodicComponent, html, css } from '@melodicdev/core';
import type { IElementRef, OnRender, OnDestroy } from '@melodicdev/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermCss from '@xterm/xterm/css/xterm.css?inline';
import { inspect } from '../store/state.js';

/**
 * An interactive `docker exec` shell rendered with xterm.js. Reads the
 * inspected container id from the `inspect` signal, opens a session through the
 * main process, and pipes bytes both ways. Mounted by the drawer only when the
 * container is running.
 */
@MelodicComponent({
  selector: 'envy-shell-term',
  // NOTE: xterm.css is injected as a real <style> element in boot() — NOT here.
  // Interpolating it through the html`` tag HTML-escapes the CSS (`>` → `&gt;`),
  // which breaks xterm's internal layout selectors and collapses the grid.
  template: () => html`<div class="term"></div>`,
  styles: () => css`
    :host {
      display: block;
      height: 280px;
      border-radius: 9px;
      border: 1px solid var(--ev-border);
      background: #0e1211; /* matches the xterm theme bg so rows blend seamlessly */
      overflow: hidden;
    }
    .term { height: 100%; width: 100%; }
    .xterm { height: 100%; padding: 10px 12px; }
    /* xterm lives in this shadow root, so style its viewport scrollbar here. */
    .xterm-viewport { background-color: transparent !important; }
    .xterm-viewport::-webkit-scrollbar { width: 10px; }
    .xterm-viewport::-webkit-scrollbar-thumb { background: var(--ev-border-2); border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
    .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
  `,
})
class ShellTermComponent implements IElementRef, OnRender, OnDestroy {
  elementRef!: HTMLElement;
  private started = false;
  private term?: Terminal;
  private fit?: FitAddon;
  private sessionId?: string;
  private offData?: () => void;
  private offExit?: () => void;

  onRender(): void {
    if (this.started) return;
    const root = this.elementRef.shadowRoot;
    const host = root?.querySelector<HTMLElement>('.term');
    const id = inspect();
    if (!root || !host || !id) return;
    this.started = true;
    // Apply xterm's stylesheet inside this shadow root as a real <style> node
    // (textContent → no HTML escaping), so xterm's layout selectors work.
    if (!root.querySelector('style[data-xterm]')) {
      const st = document.createElement('style');
      st.setAttribute('data-xterm', '');
      st.textContent = xtermCss;
      root.appendChild(st);
    }
    void this.boot(host, id);
  }

  private async boot(host: HTMLElement, id: string): Promise<void> {
    // Wait for Fira Code to load BEFORE xterm measures the glyph cell — opening
    // against the fallback font sizes the grid wrong and the first paint is
    // garbled (misaligned rows / box artifacts).
    try { await document.fonts.ready; } catch { /* ignore */ }

    const term = new Terminal({
      fontFamily: "'Fira Code', ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 2000,
      theme: { background: '#0e1211', foreground: '#e9ede9', cursor: '#34d399', selectionBackground: 'rgba(52,211,153,0.25)' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    this.term = term;
    this.fit = fit;

    // Start the pty at the already-fitted size so it never needs an immediate
    // resize (a resize sends SIGWINCH, which makes the shell redraw its prompt
    // → a duplicate prompt on first open).
    let lastCols = term.cols;
    let lastRows = term.rows;
    const { sessionId } = await window.envy.execStart(id, { cols: lastCols, rows: lastRows });
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
    term.onData((d) => window.envy.execWrite(sessionId, d));

    // Wipe any initial first-paint artifacts once the prompt has arrived,
    // leaving a clean prompt at the top of the viewport.
    setTimeout(() => { this.term?.clear(); this.fit?.fit(); }, 180);

    // Refit on real size changes only — resizing to the same dimensions would
    // needlessly poke the shell into reprinting its prompt.
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (this.sessionId && (term.cols !== lastCols || term.rows !== lastRows)) {
        lastCols = term.cols;
        lastRows = term.rows;
        window.envy.execResize(this.sessionId, { cols: lastCols, rows: lastRows });
      }
    });
    ro.observe(host);
  }

  onDestroy(): void {
    if (this.sessionId) window.envy.execStop(this.sessionId);
    this.offData?.();
    this.offExit?.();
    this.term?.dispose();
  }
}

export { ShellTermComponent };
