import { MelodicComponent, html, css } from '@melodicdev/core';
import type { TemplateResult } from '@melodicdev/core';
import { services, busy, loading, collapsedGroups, removeConfirm, domains, status, dockerProvider, startingDocker, toggleGroup } from '../store/state.js';
import type { ServiceView, Route } from '../../ipc/contract.js';
import {
  startService, stopService, restartService, openUrl, copy,
  armRemove, cancelRemove, confirmRemove, openInspect, openRun, startDocker,
} from '../store/actions.js';

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';

interface Group { project: string; standalone: boolean; services: ServiceView[]; }

const BUSY_LABEL: Record<string, string> = { start: 'Starting…', stop: 'Stopping…', restart: 'Restarting…', remove: 'Removing…' };

function portLabel(s: ServiceView): string {
  const pub = s.ports.find((p) => p.publicPort);
  if (pub) return `:${pub.publicPort}→${pub.privatePort}`;
  const exposed = s.ports.find((p) => p.type === 'tcp');
  return exposed ? `:${exposed.privatePort}` : '';
}
function metaLine(s: ServiceView): string {
  const port = portLabel(s);
  return port ? `${s.image} · ${port}` : s.image;
}

function groupServices(list: ServiceView[]): Group[] {
  const byProject = new Map<string, ServiceView[]>();
  const standalone: ServiceView[] = [];
  for (const s of list) {
    const project = s.labels[PROJECT_LABEL];
    if (project) byProject.set(project, [...(byProject.get(project) ?? []), s]);
    else standalone.push(s);
  }
  const groups = [...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, svcs]) => ({ project, standalone: false, services: svcs }));
  if (standalone.length) groups.push({ project: 'Standalone', standalone: true, services: standalone });
  return groups;
}

function groupToggleAll(g: Group, anyRunning: boolean): void {
  for (const s of g.services) {
    if (anyRunning && s.running) void stopService(s.id);
    else if (!anyRunning && !s.running) void startService(s.id);
  }
}

@MelodicComponent({
  selector: 'envy-services-view',
  template: (c: ServicesViewComponent) => {
    c.busy(); c.collapsedGroups(); c.removeConfirm(); c.domains();
    if (c.loading()) return c.renderSkeleton();
    const list = c.services();
    if (list.length === 0) {
      const offline = c.status() !== null && c.status()?.dockerConnected === false;
      if (offline) {
        const prov = c.dockerProvider();
        const starting = c.startingDocker();
        const notInstalled = prov?.installed === false;
        if (notInstalled) {
          const installUrl = prov?.installUrl ?? 'https://www.docker.com/products/docker-desktop/';
          return html`<div class="wrap"><div class="empty">
            <ml-icon icon="plugs" class="empty-icon"></ml-icon>
            <h2>Docker isn’t installed</h2>
            <p>Envy needs a Docker engine to manage your containers. Install <strong>Docker Desktop</strong> — Envy connects automatically once it's running.</p>
            <ml-button variant="primary" @ml:click=${() => void openUrl(installUrl)}>
              <ml-icon icon="download-simple" slot="icon-start"></ml-icon>Install Docker Desktop
            </ml-button>
          </div></div>`;
        }
        return html`<div class="wrap"><div class="empty">
          <ml-icon icon="plugs" class="empty-icon"></ml-icon>
          <h2>Docker isn’t running</h2>
          <p>Envy talks to your Docker daemon${prov ? html` (detected <strong>${prov.name}</strong>)` : html``}. It'll connect automatically once it's up.</p>
          ${prov?.startable
            ? html`<ml-button variant="primary" ?disabled=${starting} @ml:click=${() => void startDocker()}>
                ${starting
                  ? html`<ml-spinner size="sm" slot="icon-start"></ml-spinner>Starting ${prov.name}…`
                  : html`<ml-icon icon="play" slot="icon-start"></ml-icon>Start ${prov.name}`}
              </ml-button>`
            : html``}
        </div></div>`;
      }
      return html`<div class="wrap"><div class="empty">
        <ml-icon icon="cube" class="empty-icon"></ml-icon>
        <h2>No containers yet</h2>
        <p>Run an image and it shows up here with its own URL.</p>
        <ml-button variant="primary" @ml:click=${() => openRun()}><ml-icon icon="plus" slot="icon-start"></ml-icon>Run a container</ml-button>
      </div></div>`;
    }
    return html`<div class="wrap">
      <div class="topbar">
        <ml-button variant="primary" size="sm" @ml:click=${() => openRun()}><ml-icon icon="plus" slot="icon-start"></ml-icon>Run a container</ml-button>
      </div>
      ${groupServices(list).map((g) => c.renderGroup(g))}
    </div>`;
  },
  styles: () => css`
    :host { display: block; }
    .wrap { padding: 22px 28px 40px; display: flex; flex-direction: column; gap: 18px; }
    .topbar { display: flex; justify-content: flex-end; margin-bottom: -4px; }

    .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 50vh; color: var(--ev-faint); text-align: center; }
    .empty-icon { font-size: 40px; opacity: 0.5; }
    .empty h2 { margin: 0; font-size: 18px; color: var(--ev-dim); font-weight: 600; }
    .empty p { margin: 0; max-width: 34ch; font-size: 13px; }

    /* Group */
    .group { background: var(--ev-bg-2); border: 1px solid var(--ev-border); border-radius: 15px; overflow: hidden; }
    .ghead { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
    .caret { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--ev-dim); cursor: pointer; border-radius: 7px; }
    .caret ml-icon { transition: transform 0.2s ease; }
    .caret.collapsed ml-icon { transform: rotate(-90deg); }
    .gchip { width: 30px; height: 30px; border-radius: 8px; background: var(--ev-accent-dim); color: var(--ev-accent); display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .gname { font-weight: 600; font-size: 15px; }
    .gkind { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ev-faint); }
    .count { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 20px; background: var(--ev-surface); font-family: var(--ml-font-mono); font-size: 11px; color: var(--ev-dim); }
    .count .d { width: 6px; height: 6px; border-radius: 50%; background: var(--ev-faint); }
    .count.on .d { background: var(--ev-accent); }
    .gspacer { flex: 1; }
    .gbody { display: grid; grid-template-columns: repeat(auto-fill, minmax(338px, 1fr)); gap: 14px; padding: 0 16px 16px; }

    /* Card */
    .card { background: var(--ev-surface); border: 1px solid var(--ev-border); border-radius: 13px; padding: 16px; display: flex; flex-direction: column; gap: 13px; }
    .card.stopped { opacity: 0.66; }
    .ctop { display: flex; align-items: center; gap: 10px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ev-faint); flex: none; }
    .dot.live { background: var(--ev-accent); animation: ev-pulse 2.4s ease-out infinite; }
    .cname { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .caps { margin-left: auto; font-family: var(--ml-font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; }
    .caps.run { color: var(--ev-accent); } .caps.stop { color: var(--ev-faint); }

    .urls { display: flex; flex-direction: column; gap: 7px; }
    .urlc { display: flex; align-items: center; gap: 9px; padding: 9px 8px 9px 11px; border-radius: 9px; border: 1px solid var(--ev-border); background: var(--ev-surface-2); transition: border-color 0.15s ease; }
    .urlc.run { background: var(--ev-accent-dim); }
    .urlc.run:hover { border-color: rgba(52,211,153,0.4); }
    .lock { color: var(--ev-dim); flex: none; }
    .urlc.run .lock { color: var(--ev-accent); }
    .url { flex: 1; font-family: var(--ml-font-mono); font-size: 13px; color: var(--ev-dim); text-decoration: none; cursor: default; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .urlc.run .url { color: var(--ev-accent); cursor: pointer; }
    .urlc.run .url:hover { text-decoration: underline; }
    .utag { font-family: var(--ml-font-mono); font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ev-faint); flex: none; }
    .utag.custom { color: var(--ev-dim); background: var(--ev-surface); padding: 2px 6px; border-radius: 5px; }
    .copy { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; color: var(--ev-faint); cursor: pointer; border-radius: 5px; flex: none; }
    .copy:hover { color: var(--ev-text); }
    .nourl { font-family: var(--ml-font-mono); font-size: 12px; color: var(--ev-faint); border: 1px dashed var(--ev-border-2); border-radius: 9px; padding: 9px 11px; }
    .nourl.hint { font-family: var(--ml-font-sans); line-height: 1.5; }
    .nourl.hint code { font-family: var(--ml-font-mono); background: var(--ev-surface-2); padding: 1px 5px; border-radius: 5px; }

    .meta { display: flex; align-items: center; gap: 8px; font-family: var(--ml-font-mono); font-size: 12px; color: var(--ev-dim); }
    .meta .img { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scope {
      flex: none; display: inline-flex; align-items: center; gap: 5px;
      font-family: var(--ml-font-mono); font-size: 11px; color: var(--ev-dim);
      background: var(--ev-surface-2); border: 1px solid var(--ev-border);
      border-radius: 7px; padding: 3px 8px; cursor: pointer;
      max-width: 56%; overflow: hidden; white-space: nowrap;
    }
    .scope:hover { border-color: var(--ev-card-border-live); color: var(--ev-text); }
    .scope > span { overflow: hidden; text-overflow: ellipsis; }
    .scope .lk { font-size: 11px; opacity: 0.7; }

    .abar { display: flex; align-items: center; gap: 6px; padding-top: 12px; border-top: 1px solid var(--ev-border); }
    .aspacer { flex: 1; }
    .busy { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ev-dim); padding: 6px 4px; }
    .confirm { display: flex; align-items: center; gap: 8px; width: 100%; font-size: 12.5px; color: var(--ev-dim); }
    .confirm .q { flex: 1; }

    /* Skeleton */
    .sk { background: linear-gradient(90deg, var(--ev-surface-2) 25%, var(--ev-surface) 50%, var(--ev-surface-2) 75%); background-size: 240% 100%; animation: ev-shimmer 1.5s ease-in-out infinite; border-radius: 8px; }
    .sk-card { height: 150px; border-radius: 13px; }
  `,
})
class ServicesViewComponent {
  services = services; busy = busy; loading = loading;
  collapsedGroups = collapsedGroups; removeConfirm = removeConfirm; domains = domains; status = status;
  dockerProvider = dockerProvider; startingDocker = startingDocker;

  renderSkeleton(): TemplateResult {
    const cards = [0, 1, 2, 3];
    return html`<div class="wrap">
      ${[0, 1].map(() => html`
        <div class="group"><div class="ghead"><div class="sk" style="width:30px;height:30px;border-radius:8px;"></div><div class="sk" style="width:140px;height:14px;"></div></div>
        <div class="gbody">${cards.map(() => html`<div class="sk sk-card"></div>`)}</div></div>
      `)}
    </div>`;
  }

  private urlTag(host: string): 'local' | 'custom' {
    return this.domains().some((d) => host === d || host.endsWith(`.${d}`)) ? 'local' : 'custom';
  }

  private renderUrls(s: ServiceView): TemplateResult {
    if (s.routes.length === 0) {
      if (!s.running) return html`<div class="nourl">No published URL</div>`;
      // Exposed a port but we can't reach it: on Docker Desktop container IPs
      // aren't host-routable, so a published port is required.
      const hasExposed = s.ports.some((p) => p.type === 'tcp');
      const routable = this.status()?.containerIpsRoutable ?? true;
      if (hasExposed && !routable) {
        return html`<div class="nourl hint">Publish a port (<code>-p</code>) to get a URL — Docker Desktop can't reach container IPs.</div>`;
      }
      return html`<div class="nourl">Internal only · no published port</div>`;
    }
    return html`<div class="urls">${s.routes.map((r: Route) => {
      const url = `https://${r.host}`;
      const tag = this.urlTag(r.host);
      return html`
        <div class=${s.running ? 'urlc run' : 'urlc'}>
          <ml-icon class="lock" icon="lock-simple"></ml-icon>
          <a class="url" title=${url} @click=${(e: Event) => { e.preventDefault(); if (s.running) void openUrl(url); }}>${r.host}</a>
          <span class=${tag === 'custom' ? 'utag custom' : 'utag'}>${tag}</span>
          <button class="copy" aria-label="Copy URL" @click=${() => void copy(url)}><ml-icon icon="copy"></ml-icon></button>
        </div>`;
    })}</div>`;
  }

  private renderActions(s: ServiceView): TemplateResult {
    const b = this.busy()[s.id];
    if (b) {
      return html`<div class="abar"><span class="busy"><ml-spinner size="sm"></ml-spinner>${BUSY_LABEL[b]}</span></div>`;
    }
    if (this.removeConfirm()[s.id]) {
      return html`<div class="abar"><div class="confirm">
        <span class="q">Remove this container?</span>
        <ml-button variant="ghost" size="sm" @ml:click=${() => cancelRemove(s.id)}>Cancel</ml-button>
        <ml-button variant="danger" size="sm" @ml:click=${() => void confirmRemove(s.id)}>Remove</ml-button>
      </div></div>`;
    }
    return html`<div class="abar">
      ${s.running
        ? html`
            <ml-button variant="ghost" size="sm" @ml:click=${() => void stopService(s.id)}><ml-icon icon="stop" slot="icon-start"></ml-icon>Stop</ml-button>
            <ml-button variant="ghost" size="sm" aria-label="Restart" @ml:click=${() => void restartService(s.id)}><ml-icon icon="arrow-clockwise"></ml-icon></ml-button>`
        : html`<ml-button variant="primary" size="sm" @ml:click=${() => void startService(s.id)}><ml-icon icon="play" slot="icon-start"></ml-icon>Start</ml-button>`}
      <span class="aspacer"></span>
      <ml-button variant="ghost" size="sm" aria-label="Inspect" @ml:click=${() => openInspect(s.id)}><ml-icon icon="terminal-window"></ml-icon></ml-button>
      <ml-button variant="ghost" size="sm" aria-label="Remove" @ml:click=${() => armRemove(s.id)}><ml-icon icon="trash"></ml-icon></ml-button>
    </div>`;
  }

  renderCard(s: ServiceView, grouped: boolean): TemplateResult {
    const live = s.running;
    const title = grouped ? (s.labels[SERVICE_LABEL] ?? s.name) : s.name;
    return html`<div class=${live ? 'card' : 'card stopped'}>
      <div class="ctop">
        <span class=${live ? 'dot live' : 'dot'}></span>
        <span class="cname" title=${s.name}>${title}</span>
        <span class=${live ? 'caps run' : 'caps stop'}>${live ? 'running' : 'stopped'}</span>
      </div>
      ${this.renderUrls(s)}
      <div class="meta">
        <span class="img" title=${s.image}>${metaLine(s)}</span>
        <button class="scope" title="Domains — click to change" @click=${() => openInspect(s.id)}>
          <ml-icon icon="globe-simple"></ml-icon>
          <span>${s.domains.length === 1 ? s.domains[0] : `${s.domains.length} domains`}</span>
          ${s.domainsLocked ? html`<ml-icon icon="lock-simple" class="lk"></ml-icon>` : html``}
        </button>
      </div>
      ${this.renderActions(s)}
    </div>`;
  }

  renderGroup(g: Group): TemplateResult {
    const collapsed = this.collapsedGroups()[g.project] === true;
    const running = g.services.filter((s) => s.running).length;
    const anyRunning = running > 0;
    return html`<div class="group">
      <div class="ghead">
        <button class=${collapsed ? 'caret collapsed' : 'caret'} aria-label="Collapse" @click=${() => toggleGroup(g.project)}><ml-icon icon="caret-down"></ml-icon></button>
        <span class="gchip"><ml-icon icon=${g.standalone ? 'squares-four' : 'stack'}></ml-icon></span>
        <div>
          <div class="gname">${g.project}</div>
          ${g.standalone ? html`` : html`<div class="gkind">Compose project</div>`}
        </div>
        <span class=${anyRunning ? 'count on' : 'count'}><span class="d"></span>${running}/${g.services.length}</span>
        <span class="gspacer"></span>
        ${g.standalone ? html`` : html`<ml-button variant=${anyRunning ? 'ghost' : 'outline'} size="sm" @ml:click=${() => groupToggleAll(g, anyRunning)}>${anyRunning ? 'Stop all' : 'Start all'}</ml-button>`}
      </div>
      ${collapsed ? html`` : html`<div class="gbody">${g.services.map((s) => this.renderCard(s, !g.standalone))}</div>`}
    </div>`;
  }
}

export { ServicesViewComponent };
