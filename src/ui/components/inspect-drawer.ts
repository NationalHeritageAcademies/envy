import { MelodicComponent, html, css, signal } from '@melodicdev/core';
import type { TemplateResult, OnCreate, OnDestroy, IElementRef } from '@melodicdev/core';
import { inspect, drawerTab, inspectConfirm, services, domains, drawerWidth, setDrawerWidth, DRAWER_MIN_WIDTH } from '../store/state.js';
import type { ContainerDetail, LogLine, ServiceView } from '../../ipc/contract.js';
import {
  closeInspect, startService, stopService, restartService, confirmRemove, openUrl, copy, setContainerDomains, recreateContainer,
} from '../store/actions.js';
import './shell-term.js';

const MAX_LOGS = 500;

function logClass(line: LogLine): string {
  const t = line.text.toLowerCase();
  if (line.stream === 'stderr' || t.includes('error')) return 'lg err';
  if (t.includes('warn')) return 'lg warn';
  return 'lg info';
}

@MelodicComponent({
  selector: 'envy-inspect-drawer',
  template: (c: InspectDrawerComponent) => {
    const id = c.inspect();
    if (!id) return html``;
    const d = c.detail();
    const svc = c.services().find((s) => s.id === id);
    return html`
      <div class="scrim" @click=${() => closeInspect()}></div>
      <aside class="drawer" style=${`width:${c.drawerWidth()}px`}>
        <div class="resize" @pointerdown=${c.startResize} title="Drag to resize"></div>
        <header>
          <span class=${d?.running ? 'dot live' : 'dot'}></span>
          <span class="title">${svc?.labels['com.docker.compose.service'] ?? d?.name ?? id}</span>
          <span class=${d?.running ? 'caps run' : 'caps stop'}>${d?.running ? 'running' : 'stopped'}</span>
          <span class="spacer"></span>
          <button class="x" aria-label=${c.isExpanded() ? 'Collapse' : 'Expand'} @click=${() => c.toggleExpand()}><ml-icon icon=${c.isExpanded() ? 'arrows-in-simple' : 'arrows-out-simple'}></ml-icon></button>
          <button class="x" aria-label="Close" @click=${() => closeInspect()}><ml-icon icon="x"></ml-icon></button>
        </header>
        <div class="body">
          ${c.renderUrls(svc, d)}
          ${c.renderDomains(svc)}
          ${c.renderTabs(id, d)}
          ${d ? c.renderDetails(d) : html`<div class="loading"><ml-spinner></ml-spinner></div>`}
        </div>
        ${c.renderFooter(id, d)}
      </aside>
    `;
  },
  styles: () => css`
    :host { position: fixed; inset: 0; z-index: 100; }
    .scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); animation: ev-fade-in 0.18s ease; }
    .drawer {
      position: absolute; top: 0; right: 0; bottom: 0;
      max-width: calc(100vw - 256px);
      background: var(--ev-bg); border-left: 1px solid var(--ev-border-2);
      box-shadow: -30px 0 60px -20px rgba(0, 0, 0, 0.6);
      display: flex; flex-direction: column; animation: ev-drawer-in 0.22s ease-out;
    }
    /* Drag-to-resize handle on the left edge. */
    .resize { position: absolute; left: -3px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; z-index: 2; }
    .resize:hover { background: linear-gradient(90deg, var(--ev-accent-dim), transparent); }
    header { display: flex; align-items: center; gap: 10px; padding: 18px 18px 14px; border-bottom: 1px solid var(--ev-border); }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ev-faint); }
    .dot.live { background: var(--ev-accent); animation: ev-pulse 2.4s ease-out infinite; }
    .title { font-size: 17px; font-weight: 700; }
    .caps { font-family: var(--ml-font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; }
    .caps.run { color: var(--ev-accent); } .caps.stop { color: var(--ev-faint); }
    .spacer { flex: 1; }
    .x { width: 30px; height: 30px; border: none; background: none; color: var(--ev-dim); cursor: pointer; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
    .x:hover { background: var(--ev-surface); color: var(--ev-text); }

    .body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 18px; }
    .loading { display: flex; justify-content: center; padding: 20px; }
    .seclabel { font-family: var(--ml-font-mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ev-faint); margin-bottom: 8px; }

    .urls { display: flex; flex-direction: column; gap: 7px; }
    .urlc { display: flex; align-items: center; gap: 9px; padding: 9px 8px 9px 11px; border-radius: 9px; border: 1px solid var(--ev-border); background: var(--ev-surface-2); }
    .urlc.run { background: var(--ev-accent-dim); }
    .url { flex: 1; font-family: var(--ml-font-mono); font-size: 13px; color: var(--ev-dim); cursor: default; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .urlc.run .url { color: var(--ev-accent); cursor: pointer; }
    .lock { color: var(--ev-dim); } .urlc.run .lock { color: var(--ev-accent); }
    .copy { width: 24px; height: 24px; border: none; background: none; color: var(--ev-faint); cursor: pointer; }
    .cert { display: flex; align-items: center; gap: 7px; font-family: var(--ml-font-mono); font-size: 11.5px; color: var(--ev-dim); margin-top: 4px; }

    .dchips { display: flex; flex-wrap: wrap; gap: 7px; }
    .dchip { font-family: var(--ml-font-mono); font-size: 12px; padding: 6px 11px; border-radius: 8px; cursor: pointer; background: var(--ev-surface-2); border: 1px solid var(--ev-border); color: var(--ev-dim); }
    .dchip.on { background: var(--ev-accent-dim); border-color: rgba(52, 211, 153, 0.3); color: var(--ev-accent); }
    .dchip:disabled { cursor: default; opacity: 0.7; }
    .dnote { font-size: 11.5px; color: var(--ev-faint); margin-top: 8px; }
    .dnote code { font-family: var(--ml-font-mono); background: var(--ev-surface-2); padding: 1px 5px; border-radius: 5px; }

    .tabs { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    .tabspacer { flex: 1; }
    .clearbtn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border: none; border-radius: 8px; background: var(--ev-surface); color: var(--ev-dim); font-family: var(--ml-font-mono); font-size: 11.5px; cursor: pointer; }
    .clearbtn:hover { background: var(--ev-surface-2); color: var(--ev-text); }
    .tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: none; border-radius: 8px; background: var(--ev-surface); color: var(--ev-dim); font-family: var(--ml-font-mono); font-size: 12px; cursor: pointer; }
    .tab.active { background: var(--ev-accent-dim); color: var(--ev-accent); }
    .logs { height: 188px; overflow-y: auto; background: var(--ev-bg-2); border: 1px solid var(--ev-border); border-radius: 9px; padding: 8px 10px; }
    .lg { font-family: var(--ml-font-mono); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
    .lg.info { color: var(--ev-dim); } .lg.warn { color: #e3b341; } .lg.err { color: var(--ev-danger); }
    .stopnote { color: var(--ev-faint); font-size: 12.5px; padding: 12px; text-align: center; }

    table { width: 100%; border-collapse: collapse; }
    td { font-family: var(--ml-font-mono); font-size: 12px; padding: 4px 0; vertical-align: top; }
    td.k { color: var(--ev-dim); padding-right: 12px; white-space: nowrap; }
    td.v { color: var(--ev-text); word-break: break-all; }
    .romode { color: var(--ev-faint); }

    footer { display: flex; align-items: center; gap: 6px; padding: 14px 18px; border-top: 1px solid var(--ev-border); }
    footer .spacer { flex: 1; }
  `,
})
class InspectDrawerComponent implements OnCreate, OnDestroy, IElementRef {
  elementRef!: HTMLElement;
  inspect = inspect; detail = signal<ContainerDetail | null>(null);
  logs = signal<LogLine[]>([]); drawerTab = drawerTab; inspectConfirm = inspectConfirm; services = services;
  domains = domains; drawerWidth = drawerWidth;
  private logUnsub?: () => void;
  private svcUnsub?: () => void;
  private lastRunning?: boolean;

  private drawerEl(): HTMLElement | null {
    return this.elementRef.shadowRoot?.querySelector<HTMLElement>('.drawer') ?? null;
  }
  // Leave the 232px sidebar (+ a little gap) visible even when fully expanded.
  private maxWidth(): number { return window.innerWidth - 256; }
  isExpanded(): boolean { return this.drawerWidth() >= this.maxWidth() - 4; }

  /** One-click expand to (nearly) full width, or collapse back to default. */
  toggleExpand(): void {
    setDrawerWidth(this.isExpanded() ? 436 : this.maxWidth());
  }

  /** Drag the left edge to any width. Updated imperatively during the drag
   *  (no re-render churn), then committed to the persisted signal on release. */
  startResize = (e: PointerEvent): void => {
    e.preventDefault();
    const el = this.drawerEl();
    if (!el) return;
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    const max = this.maxWidth();
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent): void => {
      const w = Math.min(max, Math.max(DRAWER_MIN_WIDTH, startW + (startX - ev.clientX)));
      el.style.width = `${w}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      setDrawerWidth(el.getBoundingClientRect().width);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  onCreate(): void {
    // The drawer is mounted only while open, so load for the current target now.
    const id = inspect();
    if (id) void this.load(id);
    // Watch container state: when the inspected container comes back up after a
    // restart, the old `docker logs --follow` stream has ended — re-attach so
    // the tail keeps flowing without reopening the drawer.
    this.svcUnsub = services.subscribe((list) => {
      const cur = inspect();
      if (!cur) return;
      const running = list.find((s) => s.id === cur)?.running ?? false;
      if (running && this.lastRunning === false) {
        this.logs.set([]);
        this.subscribeLogStream(cur);
        void window.envy.inspectContainer(cur).then((d) => this.detail.set(d)).catch(() => {});
      }
      this.lastRunning = running;
    });
  }
  onDestroy(): void { this.teardown(); }

  private appendLog(line: LogLine): void {
    const next = [...this.logs(), line];
    if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
    this.logs.set(next);
  }
  private subscribeLogStream(id: string): void {
    this.logUnsub?.();
    this.logUnsub = window.envy.subscribeLogs(id, (line) => this.appendLog(line));
  }
  clearLogs = (): void => this.logs.set([]);

  private async load(id: string): Promise<void> {
    this.teardown();
    this.detail.set(null);
    this.logs.set([]);
    try {
      const d = await window.envy.inspectContainer(id);
      this.detail.set(d);
      this.lastRunning = d.running;
    } catch { /* ignore */ }
    this.subscribeLogStream(id);
  }
  private teardown(): void {
    this.logUnsub?.(); this.logUnsub = undefined;
    this.svcUnsub?.(); this.svcUnsub = undefined;
  }

  renderUrls(svc: ServiceView | undefined, d: ContainerDetail | null): TemplateResult {
    const running = d?.running ?? svc?.running ?? false;
    const routes = svc?.routes ?? [];
    return html`
      <div>
        <div class="seclabel">URLs</div>
        ${routes.length === 0
          ? html`<div class="cert">No published URL</div>`
          : html`<div class="urls">${routes.map((r) => {
              const url = `https://${r.host}`;
              return html`<div class=${running ? 'urlc run' : 'urlc'}>
                <ml-icon class="lock" icon="lock-simple"></ml-icon>
                <a class="url" title=${url} @click=${(e: Event) => { e.preventDefault(); if (running) void openUrl(url); }}>${r.host}</a>
                <button class="copy" aria-label="Copy" @click=${() => void copy(url)}><ml-icon icon="copy"></ml-icon></button>
              </div>`;
            })}</div>`}
        <div class="cert"><ml-icon icon="lock-simple"></ml-icon>${running ? 'HTTPS · local CA trusted' : 'HTTPS ready when running'}</div>
      </div>
    `;
  }

  renderDomains(svc: ServiceView | undefined): TemplateResult {
    const configured = this.domains();
    if (!svc || configured.length === 0) return html``;
    const labelControlled = svc.domainsLocked;
    // Drive chip state from the EFFECTIVE domains (label/assignment/primary),
    // computed in the main process — accurate even when the container is stopped.
    const active = new Set(svc.domains);
    return html`
      <div>
        <div class="seclabel">Domains</div>
        <div class="dchips">
          ${configured.map((d) => {
            const on = active.has(d);
            return html`<button
              class=${on ? 'dchip on' : 'dchip'}
              ?disabled=${labelControlled}
              @click=${() => {
                const next = new Set(active);
                if (on) next.delete(d); else next.add(d);
                if (next.size === 0) return; // keep at least one
                void setContainerDomains(svc.name, [...next]);
              }}
            >*.${d}</button>`;
          })}
        </div>
        ${labelControlled
          ? html`<div class="dnote">Set by the <code>envy.domains</code> label.</div>`
          : html`<div class="dnote">Tap to choose which domains this container is reachable on.</div>`}
      </div>
    `;
  }

  renderTabs(id: string, d: ContainerDetail | null): TemplateResult {
    const tab = this.drawerTab();
    const running = d?.running ?? false;
    return html`
      <div>
        <div class="tabs">
          <button class=${tab === 'logs' ? 'tab active' : 'tab'} @click=${() => drawerTab.set('logs')}><ml-icon icon="list-bullets"></ml-icon>Logs</button>
          <button class=${tab === 'shell' ? 'tab active' : 'tab'} @click=${() => drawerTab.set('shell')}><ml-icon icon="terminal-window"></ml-icon>Shell</button>
          <span class="tabspacer"></span>
          ${tab === 'logs' ? html`<button class="clearbtn" title="Clear the log view (doesn't affect Docker)" @click=${this.clearLogs}><ml-icon icon="eraser"></ml-icon>Clear</button>` : html``}
        </div>
        ${tab === 'logs'
          ? html`<div class="logs">${this.logs().map((l) => html`<div class=${logClass(l)}>${l.text}</div>`)}</div>`
          : running
            ? html`<envy-shell-term .key=${id}></envy-shell-term>`
            : html`<div class="stopnote">Container is not running — Start it to open a shell.</div>`}
      </div>
    `;
  }

  renderDetails(d: ContainerDetail): TemplateResult {
    return html`
      ${d.env.length ? html`<div><div class="seclabel">Environment</div><table>${d.env.slice(0, 40).map((e) => html`<tr><td class="k">${e.key}</td><td class="v">${e.value}</td></tr>`)}</table></div>` : html``}
      ${d.mounts.length ? html`<div><div class="seclabel">Mounts</div><table>${d.mounts.map((m) => html`<tr><td class="v">${m.source} → ${m.destination}</td><td class="k romode">${m.mode}</td></tr>`)}</table></div>` : html``}
      <div>
        <div class="seclabel">Details</div>
        <table>
          <tr><td class="k">image</td><td class="v">${d.image}</td></tr>
          <tr><td class="k">id</td><td class="v">${d.id}</td></tr>
          <tr><td class="k">ports</td><td class="v">${d.ports.map((p) => `${p.host ? `${p.host}→` : ''}${p.container}/${p.type}`).join('  ') || '—'}</td></tr>
        </table>
      </div>
    `;
  }

  renderFooter(id: string, d: ContainerDetail | null): TemplateResult {
    const running = d?.running ?? false;
    const armed = this.inspectConfirm();
    return html`<footer>
      ${running
        ? html`
            <ml-button variant="ghost" size="sm" @ml:click=${() => void stopService(id)}><ml-icon icon="stop" slot="icon-start"></ml-icon>Stop</ml-button>
            <ml-button variant="ghost" size="sm" aria-label="Restart" @ml:click=${() => void restartService(id)}><ml-icon icon="arrow-clockwise"></ml-icon></ml-button>`
        : html`<ml-button variant="primary" size="sm" @ml:click=${() => void startService(id)}><ml-icon icon="play" slot="icon-start"></ml-icon>Start</ml-button>`}
      <ml-button variant="ghost" size="sm" title="Pull the latest image + recreate this container" @ml:click=${() => void recreateContainer(id)}>
        <ml-icon icon="download-simple" slot="icon-start"></ml-icon>Update
      </ml-button>
      <span class="spacer"></span>
      ${armed
        ? html`
            <ml-button variant="ghost" size="sm" @ml:click=${() => inspectConfirm.set(false)}>Cancel</ml-button>
            <ml-button variant="danger" size="sm" @ml:click=${() => void confirmRemove(id)}>Remove</ml-button>`
        : html`<ml-button variant="ghost" size="sm" aria-label="Remove" @ml:click=${() => inspectConfirm.set(true)}><ml-icon icon="trash"></ml-icon></ml-button>`}
    </footer>`;
  }
}

export { InspectDrawerComponent };
