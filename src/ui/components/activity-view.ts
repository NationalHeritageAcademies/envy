import { MelodicComponent, html, css, signal } from '@melodicdev/core';
import type { TemplateResult, OnCreate, OnDestroy } from '@melodicdev/core';
import { services } from '../store/state.js';
import type { StatSample } from '../../ipc/contract.js';

const HIST = 28; // sparkline history length
const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';

function kbps(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1e3).toFixed(1)} KB/s`;
}
function mem(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
/** Build an SVG polyline `points` string from a history array, fit to w×h. */
function spark(hist: number[], w: number, h: number): string {
  if (hist.length < 2) return `0,${h} ${w},${h}`;
  const max = Math.max(...hist, 0.0001);
  const step = w / (HIST - 1);
  return hist.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
}

@MelodicComponent({
  selector: 'envy-activity-view',
  template: (c: ActivityViewComponent) => {
    c.samples(); c.collapsed();
    const byId = new Map(c.samples().map((s) => [s.id, s]));
    const groups = c.groupRows(byId);
    const totals = c.totals();
    return html`
      <div class="wrap">
        <div class="tiles">
          ${c.tile('CPU', `${totals.cpu.toFixed(1)}%`, c.histCpu, 'var(--ev-accent)')}
          ${c.tile('Memory', mem(totals.mem), c.histMem, '#5aa9ff')}
          ${c.tile('Network', kbps(totals.net), c.histNet, '#c084fc')}
          ${c.tile('Disk', kbps(totals.disk), c.histDisk, '#e3b341')}
        </div>

        <div class="table">
          <div class="thead"><span class="name">NAME</span><span class="num">CPU</span><span class="num">MEMORY</span><span class="num">NETWORK</span><span class="num">DISK</span></div>
          ${groups.map((g) => c.renderGroup(g, byId))}
        </div>
      </div>
    `;
  },
  styles: () => css`
    :host { display: block; }
    .wrap { padding: 22px 28px 40px; display: flex; flex-direction: column; gap: 18px; }
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .tile { background: var(--ev-surface); border: 1px solid var(--ev-border); border-radius: 13px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .tile .lbl { font-family: var(--ml-font-mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ev-faint); }
    .tile .val { font-family: var(--ml-font-mono); font-size: 22px; font-weight: 600; color: var(--ev-text); }

    .table { background: var(--ev-bg-2); border: 1px solid var(--ev-border); border-radius: 14px; overflow: hidden; }
    .thead { display: grid; grid-template-columns: 1fr 110px 110px 110px 110px; padding: 12px 16px; border-bottom: 1px solid var(--ev-border); font-family: var(--ml-font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--ev-faint); }
    .thead .num { text-align: right; }
    .grow, .row { display: grid; grid-template-columns: 1fr 110px 110px 110px 110px; align-items: center; padding: 11px 16px; border-bottom: 1px solid var(--ev-border); }
    .row:last-child, .grow:last-child { border-bottom: none; }
    .grow { cursor: pointer; }
    .grow .name { display: flex; align-items: center; gap: 10px; font-weight: 600; }
    .grow .gchip { width: 30px; height: 30px; border-radius: 8px; background: var(--ev-accent-dim); color: var(--ev-accent); display: inline-flex; align-items: center; justify-content: center; }
    .gcount { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ev-faint); margin-left: 4px; }
    .caret ml-icon { transition: transform 0.2s ease; }
    .caret.collapsed ml-icon { transform: rotate(-90deg); }
    .row .name { display: flex; align-items: center; gap: 10px; padding-left: 28px; color: var(--ev-dim); }
    .row.run .name { color: var(--ev-text); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ev-faint); flex: none; }
    .row.run .dot { background: var(--ev-accent); }
    .num { text-align: right; font-family: var(--ml-font-mono); font-size: 12.5px; color: var(--ev-dim); }
    .cpu { display: inline-flex; align-items: center; gap: 8px; justify-content: flex-end; }
    .cpu .v { color: var(--ev-accent); } .row:not(.run) .cpu .v, .grow .cpu .v { color: inherit; }
    .grow .cpu .v { color: var(--ev-accent); }
  `,
})
class ActivityViewComponent implements OnCreate, OnDestroy {
  samples = signal<StatSample[]>([]);
  services = services;
  collapsed = signal<Record<string, boolean>>(loadActivityCollapsed());

  histCpu: number[] = []; histMem: number[] = []; histNet: number[] = []; histDisk: number[] = [];
  private cpuHistById = new Map<string, number[]>();
  private unsub?: () => void;

  onCreate(): void {
    this.unsub = window.envy.subscribeStats((samples) => {
      this.samples.set(samples);
      const t = this.sum(samples);
      push(this.histCpu, t.cpu); push(this.histMem, t.mem); push(this.histNet, t.net); push(this.histDisk, t.disk);
      for (const s of samples) {
        const h = this.cpuHistById.get(s.id) ?? [];
        push(h, s.cpu);
        this.cpuHistById.set(s.id, h);
      }
    });
  }
  onDestroy(): void { this.unsub?.(); }

  private sum(samples: StatSample[]): { cpu: number; mem: number; net: number; disk: number } {
    return samples.reduce((a, s) => ({ cpu: a.cpu + s.cpu, mem: a.mem + s.memBytes, net: a.net + s.netRate, disk: a.disk + s.diskRate }), { cpu: 0, mem: 0, net: 0, disk: 0 });
  }
  totals(): { cpu: number; mem: number; net: number; disk: number } { return this.sum(this.samples()); }

  tile(label: string, value: string, hist: number[], color: string): TemplateResult {
    return html`<div class="tile">
      <span class="lbl">${label}</span>
      <span class="val">${value}</span>
      <svg width="100%" height="40" viewBox="0 0 200 40" preserveAspectRatio="none" style="overflow:visible;">
        <polyline points=${spark(hist, 200, 40)} fill="none" stroke=${color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
    </div>`;
  }

  groupRows(byId: Map<string, StatSample>): { project: string; ids: string[] }[] {
    const map = new Map<string, string[]>();
    for (const s of this.services()) {
      const project = s.labels[PROJECT_LABEL] ?? 'Standalone';
      map.set(project, [...(map.get(project) ?? []), s.id]);
    }
    void byId;
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([project, ids]) => ({ project, ids }));
  }

  renderGroup(g: { project: string; ids: string[] }, byId: Map<string, StatSample>): TemplateResult {
    const collapsed = this.collapsed()[g.project] === true;
    const svc = new Map(this.services().map((s) => [s.id, s]));
    const samples = g.ids.map((id) => byId.get(id)).filter(Boolean) as StatSample[];
    const running = samples.filter((s) => s.running).length;
    const t = this.sum(samples);
    return html`
      <div class="grow" @click=${() => this.toggle(g.project)}>
        <span class="name">
          <span class=${collapsed ? 'caret collapsed' : 'caret'}><ml-icon icon="caret-down"></ml-icon></span>
          <span class="gchip"><ml-icon icon="stack"></ml-icon></span>${g.project}<span class="gcount">${running}/${g.ids.length}</span>
        </span>
        <span class="num cpu"><span class="v">${t.cpu.toFixed(1)}%</span></span>
        <span class="num">${mem(t.mem)}</span>
        <span class="num">${kbps(t.net)}</span>
        <span class="num">${kbps(t.disk)}</span>
      </div>
      ${collapsed ? html`` : g.ids.map((id) => {
        const s = byId.get(id);
        const meta = svc.get(id);
        const name = meta?.labels[SERVICE_LABEL] ?? meta?.name ?? id;
        const run = s?.running === true;
        return html`<div class=${run ? 'row run' : 'row'}>
          <span class="name"><span class="dot"></span>${name}</span>
          <span class="num cpu">
            <svg width="34" height="14" viewBox="0 0 34 14" preserveAspectRatio="none" style="overflow:visible;"><polyline points=${spark(this.cpuHistById.get(id) ?? [], 34, 14)} fill="none" stroke="var(--ev-accent)" stroke-width="1.3" opacity="0.85" stroke-linejoin="round" /></svg>
            <span class="v">${run ? `${(s?.cpu ?? 0).toFixed(1)}%` : '—'}</span>
          </span>
          <span class="num">${run ? mem(s?.memBytes ?? 0) : '—'}</span>
          <span class="num">${run ? kbps(s?.netRate ?? 0) : '—'}</span>
          <span class="num">${run ? kbps(s?.diskRate ?? 0) : '—'}</span>
        </div>`;
      })}
    `;
  }

  private toggle(project: string): void {
    const next = { ...this.collapsed() };
    next[project] = !next[project];
    this.collapsed.set(next);
    try { globalThis.localStorage?.setItem('envy:activityCollapsed', JSON.stringify(next)); } catch { /* ignore */ }
  }
}

function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > HIST) arr.shift();
}

function loadActivityCollapsed(): Record<string, boolean> {
  try { return JSON.parse(globalThis.localStorage?.getItem('envy:activityCollapsed') ?? '{}') as Record<string, boolean>; } catch { return {}; }
}

export { ActivityViewComponent };
