import { MelodicComponent, html, css } from '@melodicdev/core';
import { appSettings, appVersion, updateChecking, updateCheckMsg } from '../store/state.js';
import { setAppSetting, checkForUpdates } from '../store/actions.js';

/** Read the checked state off a Melodic ml:change event. */
const checkedOf = (e: Event): boolean => (e as CustomEvent<{ checked: boolean }>).detail.checked;

@MelodicComponent({
  selector: 'envy-settings-view',
  template: (c: SettingsViewComponent) => {
    const s = c.appSettings();
    return html`
      <div class="wrap">
        <section class="group">
          <h2>General</h2>
          <div class="card">
            <div class="row">
              <div class="rtext">
                <span class="title">Keep running in background</span>
                <span class="hint">Closing the window leaves Envy in the menu bar so your URLs stay served.</span>
              </div>
              <ml-toggle ?checked=${s.keepRunningInBackground}
                @ml:change=${(e: Event) => void setAppSetting('keepRunningInBackground', checkedOf(e))}></ml-toggle>
            </div>
            <div class="row">
              <div class="rtext">
                <span class="title">Start at login</span>
                <span class="hint">Launch Envy automatically when you log in.</span>
              </div>
              <ml-toggle ?checked=${s.startAtLogin}
                @ml:change=${(e: Event) => void setAppSetting('startAtLogin', checkedOf(e))}></ml-toggle>
            </div>
          </div>
        </section>

        <section class="group">
          <h2>Updates</h2>
          <div class="card">
            <div class="row">
              <div class="rtext">
                <span class="title">Envy ${c.appVersion() ? `v${c.appVersion()}` : ''}</span>
                <span class="hint">${c.updateCheckMsg() || 'Envy updates automatically in the background.'}</span>
              </div>
              <ml-button variant="secondary" ?disabled=${c.updateChecking()} @ml:click=${() => void checkForUpdates()}>
                ${c.updateChecking()
                  ? html`<ml-spinner size="sm" slot="icon-start"></ml-spinner>Checking…`
                  : html`<ml-icon icon="arrow-clockwise" slot="icon-start"></ml-icon>Check for Updates`}
              </ml-button>
            </div>
          </div>
        </section>
      </div>
    `;
  },
  styles: () => css`
    :host { display: block; }
    .wrap { padding: 24px 28px 40px; display: flex; flex-direction: column; gap: 26px; max-width: 620px; }
    .group { display: flex; flex-direction: column; gap: 10px; }
    h2 { margin: 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ev-dim); }
    .card { background: var(--ev-bg-2); border: 1px solid var(--ev-border); border-radius: 14px; overflow: hidden; }
    .row { display: flex; align-items: center; gap: 18px; padding: 15px 16px; border-bottom: 1px solid var(--ev-border); }
    .row:last-child { border-bottom: none; }
    .rtext { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .title { font-size: 14px; font-weight: 600; color: var(--ev-text); }
    .hint { font-size: 12.5px; color: var(--ev-dim); line-height: 1.5; }
  `,
})
class SettingsViewComponent {
  appSettings = appSettings;
  appVersion = appVersion;
  updateChecking = updateChecking;
  updateCheckMsg = updateCheckMsg;
}

export { SettingsViewComponent };
