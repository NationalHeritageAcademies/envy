import { MelodicComponent, html, css } from '@melodicdev/core';
import type { TemplateResult } from '@melodicdev/core';
import { view, status, daemon, daemonBusy, loading, theme, platform, services, images, domains, inspect, updateReady, appVersion } from '../store/state.js';
import type { View } from '../store/state.js';
import { enableDaemon, disableDaemon, toggleTheme, restartForUpdate } from '../store/actions.js';
import { envyEye } from './brand.js';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'services', label: 'Services', icon: 'squares-four' },
  { id: 'images', label: 'Images', icon: 'cube' },
  { id: 'domains', label: 'Domains', icon: 'globe-simple' },
  { id: 'activity', label: 'Activity', icon: 'pulse' },
];

const TITLE: Record<View, string> = {
  services: 'Services',
  images: 'Images',
  domains: 'Domains',
  activity: 'Activity Monitor',
  settings: 'Settings',
};

@MelodicComponent({
  selector: 'envy-app',
  template: (c: EnvyAppComponent) => {
    const current = c.view();
    const mac = c.platform() === 'darwin';
    const win = c.platform() === 'win32';
    return html`
      <aside class="sidebar">
        <!-- Clearance for the OS window controls (macOS traffic lights on the
             left; Windows Controls Overlay sits top-right, so the sidebar just
             needs a little breathing room under the frameless top edge). -->
        <div class=${mac ? 'traffic-pad-mac' : win ? 'traffic-pad-win' : 'traffic-pad'}></div>
        <div class="brand">${envyEye(30)}<span class="wordmark">Envy</span></div>
        <nav>
          ${NAV.map(
            (item) => html`
              <button class=${current === item.id ? 'nav active' : 'nav'} @click=${() => c.view.set(item.id)}>
                <ml-icon icon=${item.icon}></ml-icon><span>${item.label}</span>
              </button>
            `,
          )}
        </nav>
        <div class="side-foot">
          <span class="ver">${c.appVersion() ? `v${c.appVersion()}` : ''} · ${c.daemon()?.running ? 'daemon ready' : 'daemon off'}</span>
          <div class="foot-actions">
            <button class=${current === 'settings' ? 'foot-btn active' : 'foot-btn'} aria-label="Settings" @click=${() => c.view.set('settings')}>
              <ml-icon icon="gear-six"></ml-icon>
            </button>
            <button class="foot-btn" aria-label="Toggle theme" @click=${() => toggleTheme()}>
              <ml-icon icon=${c.theme() === 'dark' ? 'sun' : 'moon'}></ml-icon>
            </button>
          </div>
        </div>
      </aside>

      <main>
        <header class=${win ? 'win' : ''}>
          <div class="htext">
            <h1>${TITLE[current]}</h1>
            <span class="subtitle">${c.subtitle()}</span>
          </div>
          <div class="header-actions">
            ${c.renderUpdatePill()}
            ${c.renderPill()}
          </div>
        </header>
        <section class="content">
          ${current === 'services' ? html`<envy-services-view></envy-services-view>`
            : current === 'images' ? html`<envy-images-view></envy-images-view>`
            : current === 'domains' ? html`<envy-domains-view></envy-domains-view>`
            : current === 'settings' ? html`<envy-settings-view></envy-settings-view>`
            : html`<envy-activity-view></envy-activity-view>`}
        </section>
      </main>

      ${c.inspect() ? html`<envy-inspect-drawer></envy-inspect-drawer>` : html``}
      <envy-run-dialog></envy-run-dialog>
    `;
  },
  styles: () => css`
    :host {
      display: grid;
      grid-template-columns: 232px 1fr;
      grid-template-rows: minmax(0, 1fr);
      height: 100vh;
      overflow: hidden;
      color: var(--ev-text);
      position: relative;
    }
    /* Top-edge green glow behind the header */
    :host::before {
      content: '';
      position: absolute;
      top: 0; left: 232px; right: 0; height: 140px;
      background: radial-gradient(70% 130px at 40% -25%, var(--ev-accent-dim), transparent 72%);
      pointer-events: none; z-index: 0;
    }

    .sidebar {
      background: var(--ev-side);
      border-right: 1px solid var(--ev-border);
      display: flex; flex-direction: column; gap: 4px;
      padding: 0 12px 14px;
      -webkit-app-region: drag;
    }
    .traffic-pad-mac { height: 38px; } /* clears the OS traffic lights */
    .traffic-pad { height: 14px; }
    .traffic-pad-win { height: 30px; } /* breathing room under the frameless top edge */

    .brand { display: flex; align-items: center; gap: 9px; height: 44px; padding: 0 6px; margin-bottom: 6px; }
    .wordmark { font-weight: 700; font-size: 20px; letter-spacing: -0.015em; }

    nav { display: flex; flex-direction: column; gap: 3px; }
    .nav {
      -webkit-app-region: no-drag;
      display: flex; align-items: center; gap: 11px;
      padding: 9px 12px; border: none; border-radius: 9px; background: none;
      color: var(--ev-dim); font-family: var(--ml-font-sans); font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
    }
    .nav:hover { color: var(--ev-text); background: var(--ev-surface); }
    .nav.active { color: var(--ev-accent); background: var(--ev-accent-dim); }

    .side-foot {
      -webkit-app-region: no-drag;
      margin-top: auto; padding-top: 12px; border-top: 1px solid var(--ev-border);
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .ver { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ev-faint); }
    .foot-actions { display: inline-flex; align-items: center; gap: 2px; }
    .foot-btn {
      width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
      border: none; border-radius: 8px; background: none; color: var(--ev-dim); cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .foot-btn:hover { background: var(--ev-surface); color: var(--ev-text); }
    .foot-btn.active { background: var(--ev-accent-dim); color: var(--ev-accent); }

    main { display: flex; flex-direction: column; min-width: 0; position: relative; z-index: 1; }
    header {
      display: flex; align-items: center; justify-content: space-between;
      height: 64px; padding: 0 28px; flex-shrink: 0;
      border-bottom: 1px solid var(--ev-border); -webkit-app-region: drag;
    }
    /* Windows: keep the header actions clear of the top-right window-controls
       overlay (min/max/close) so they're not covered or un-clickable. */
    header.win { padding-right: 148px; }
    .htext { display: flex; flex-direction: column; gap: 2px; }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    header h1 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }

    /* "Restart to update" pill — visible only while electron-updater has a
       staged update waiting (updateReady non-null). */
    .update-pill {
      -webkit-app-region: no-drag;
      display: inline-flex; align-items: center; gap: 7px;
      padding: 6px 12px; border-radius: 13px; cursor: pointer;
      background: var(--ev-accent-dim); border: 1px solid rgba(52, 211, 153, 0.3);
      color: var(--ev-accent); font-family: var(--ml-font-sans); font-size: 12px; font-weight: 600;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .update-pill:hover { background: var(--ev-accent); color: #04130c; }
    .update-pill ml-icon { font-size: 14px; }
    .subtitle { font-family: var(--ml-font-mono); font-size: 12px; color: var(--ev-dim); white-space: nowrap; }
    .content { flex: 1; overflow-y: auto; }

    /* Daemon status pill */
    .pill {
      -webkit-app-region: no-drag;
      display: inline-flex; align-items: center; gap: 9px;
      padding: 5px 5px 5px 13px; border-radius: 13px;
      background: var(--ev-surface); border: 1px solid var(--ev-border);
      font-size: 12px; color: var(--ev-dim);
    }
    .pill.live { background: var(--ev-accent-dim); border-color: rgba(52, 211, 153, 0.3); color: var(--ev-text); }
    .pill .label { font-family: var(--ml-font-mono); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ev-faint); }
    .pill.live .dot { background: var(--ev-accent); animation: ev-pulse 2.4s ease-out infinite; }
    .pill ml-button { --ml-button-border-radius: 8px; }
  `,
})
class EnvyAppComponent {
  view = view;
  status = status;
  daemon = daemon;
  daemonBusy = daemonBusy;
  loading = loading;
  theme = theme;
  platform = platform;
  // Read so the header subtitle re-renders as data changes.
  services = services;
  images = images;
  domains = domains;
  inspect = inspect;
  updateReady = updateReady;
  appVersion = appVersion;

  subtitle(): string {
    switch (this.view()) {
      case 'services': {
        const list = this.services();
        return `${list.filter((s) => s.running).length} of ${list.length} services running`;
      }
      case 'images':
        return `${this.images().length} local images`;
      case 'domains': {
        const d = this.domains();
        return `${d.length} domain${d.length === 1 ? '' : 's'} served · *.${d[0] ?? 'envy.local'}`;
      }
      case 'activity':
        return 'Live resource usage · updates every 1.5s';
      case 'settings':
        return 'App preferences · keep-running, login, updates';
    }
  }

  /** "Restart to update" pill — only shown once electron-updater has staged a
   *  newer version (updateReady is non-null). Clicking relaunches into it. */
  renderUpdatePill(): TemplateResult {
    const v = this.updateReady();
    if (!v) return html``;
    return html`
      <button class="update-pill" title="Envy ${v} has been downloaded. Click to restart and install." @click=${() => restartForUpdate()}>
        <ml-icon icon="arrow-clockwise"></ml-icon><span>Restart to update</span>
      </button>
    `;
  }

  renderPill(): TemplateResult {
    const s = this.status();
    if (s && !s.dockerConnected) {
      return html`<span class="pill"><span class="dot"></span><span class="label">Docker offline</span></span>`;
    }
    if (this.daemonBusy()) {
      return html`<span class="pill"><ml-spinner size="sm"></ml-spinner><span class="label">Starting daemon…</span></span>`;
    }
    const d = this.daemon();
    if (d?.installed && d.running) {
      // Only claim "live" when the proxy port actually answered the probe —
      // a daemon that broke mid-reconfigure is running but serving nothing.
      if (!d.proxyListening) {
        return html`
          <span class="pill" title="The Envy daemon is running but nothing is answering on the proxy port. Check ~/Library/Application Support/Envy/daemon.log.">
            <span class="dot"></span><span class="label">URLs not responding</span>
            <ml-button variant="ghost" size="sm" aria-label="Disable Envy daemon" @ml:click=${() => void disableDaemon()}>
              <ml-icon icon="power"></ml-icon>
            </ml-button>
          </span>
        `;
      }
      return html`
        <span class="pill live">
          <span class="dot"></span><span class="label">URLs live</span>
          <ml-button variant="ghost" size="sm" aria-label="Disable Envy daemon" @ml:click=${() => void disableDaemon()}>
            <ml-icon icon="power"></ml-icon>
          </ml-button>
        </span>
      `;
    }
    return html`
      <span class="pill">
        <span class="dot"></span><span class="label">URLs off</span>
        <ml-button variant="primary" size="sm" @ml:click=${() => void enableDaemon()}>
          <ml-icon icon="lightning" slot="icon-start"></ml-icon>Enable URLs
        </ml-button>
      </span>
    `;
  }
}

export { EnvyAppComponent };
