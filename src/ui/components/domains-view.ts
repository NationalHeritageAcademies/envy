import { MelodicComponent, html, css, signal } from '@melodicdev/core';
import { domains } from '../store/state.js';
import { addDomain, removeDomain, setPrimaryDomain } from '../store/actions.js';

@MelodicComponent({
  selector: 'envy-domains-view',
  template: (c: DomainsViewComponent) => {
    const list = c.domains();
    return html`
      <div class="wrap">
        <p class="lead">
          Envy serves zero-config HTTPS for each suffix below. The <strong>primary</strong> one is the
          default: every container gets a <code>&lt;name&gt;.${list[0] ?? 'envy'}</code> URL unless
          you assign it more domains (per-container, in its Inspect drawer).
        </p>
        <div class="addbar">
          <div class="inputwrap">
            <span class="star">*.</span>
            <ml-input class="add" placeholder="add a suffix  ·  e.g. acme.test" .value=${c.draft()}
              @input=${(e: Event) => c.draft.set((e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') c.add(); }}></ml-input>
          </div>
          <ml-button variant="primary" ?disabled=${!c.draft().trim()} @ml:click=${c.add}>
            <ml-icon icon="plus" slot="icon-start"></ml-icon>Add
          </ml-button>
        </div>
        <div class="list">
          ${list.map((d, i) => html`<div class="row">
            <span class="chip"><ml-icon icon="globe-simple"></ml-icon></span>
            <span class="domain"><span class="star">*.</span>${d}</span>
            ${i === 0
              ? html`<span class="primary">primary</span>`
              : html`<span class="rowactions">
                  <ml-button variant="ghost" size="sm" @ml:click=${() => void setPrimaryDomain(d)}>
                    <ml-icon icon="star" slot="icon-start"></ml-icon>Make primary
                  </ml-button>
                  <ml-button variant="ghost" size="sm" aria-label="Remove domain" @ml:click=${() => void removeDomain(d)}><ml-icon icon="trash"></ml-icon></ml-button>
                </span>`}
          </div>`)}
        </div>
      </div>
    `;
  },
  styles: () => css`
    :host { display: block; }
    .wrap { padding: 24px 28px 40px; display: flex; flex-direction: column; gap: 16px; max-width: 620px; }
    .lead { color: var(--ev-dim); font-size: 13.5px; line-height: 1.6; margin: 0; }
    .lead strong { color: var(--ev-text); font-weight: 600; }
    .lead code { font-family: var(--ml-font-mono); font-size: 12px; background: var(--ev-surface-2); padding: 1px 6px; border-radius: 5px; color: var(--ev-accent); }
    .addbar { display: flex; gap: 10px; }
    .inputwrap { position: relative; flex: 1; display: flex; align-items: center; }
    .inputwrap .star { position: absolute; left: 12px; font-family: var(--ml-font-mono); font-size: 13px; color: var(--ev-faint); pointer-events: none; z-index: 1; }
    .add { flex: 1; --ml-input-padding-left: 30px; }
    .list { background: var(--ev-bg-2); border: 1px solid var(--ev-border); border-radius: 14px; overflow: hidden; }
    .row { display: flex; align-items: center; gap: 14px; padding: 11px 14px; border-bottom: 1px solid var(--ev-border); }
    .row:last-child { border-bottom: none; }
    .chip { width: 34px; height: 34px; border-radius: 8px; background: var(--ev-accent-dim); color: var(--ev-accent); display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .domain { flex: 1; font-family: var(--ml-font-mono); font-size: 14.5px; color: var(--ev-text); }
    .domain .star { color: var(--ev-faint); }
    .primary { font-family: var(--ml-font-mono); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 10px; border-radius: 20px; background: var(--ev-accent-dim); color: var(--ev-accent); }
    .rowactions { display: inline-flex; align-items: center; gap: 4px; }
  `,
})
class DomainsViewComponent {
  domains = domains;
  draft = signal('');

  add = (): void => {
    const v = this.draft().trim();
    if (!v) return;
    void addDomain(v);
    this.draft.set('');
  };
}

export { DomainsViewComponent };
