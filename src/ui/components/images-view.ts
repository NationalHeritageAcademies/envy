import { MelodicComponent, html, css, signal } from '@melodicdev/core';
import { images, services, loading } from '../store/state.js';
import { pullImage, removeImage, openRun, updateImage, reloadImages } from '../store/actions.js';

function sizeLabel(bytes: number): string {
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
function ageLabel(createdSec: number): string {
  const days = Math.floor((Date.now() / 1000 - createdSec) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

@MelodicComponent({
  selector: 'envy-images-view',
  template: (c: ImagesViewComponent) => {
    const used = new Set(c.services().map((s) => s.image));
    const q = c.filter().toLowerCase();
    const list = c.images().filter((img) => (img.tags[0] ?? '').toLowerCase().includes(q));
    return html`
      <div class="wrap">
        <div class="pullbar">
          <ml-input class="pull" placeholder="Pull an image  ·  e.g. postgres:16" .value=${c.draft()}
            @input=${(e: Event) => c.draft.set((e.target as HTMLInputElement).value)}></ml-input>
          <ml-button variant="primary" ?disabled=${!c.draft().trim()} @ml:click=${c.pull}>
            <ml-icon icon="download-simple" slot="icon-start"></ml-icon>Pull
          </ml-button>
        </div>
        <ml-input class="filter" placeholder="Filter local images" .value=${c.filter()}
          @input=${(e: Event) => c.filter.set((e.target as HTMLInputElement).value)}></ml-input>

        ${c.loading()
          ? html`<div class="empty"><ml-spinner></ml-spinner></div>`
          : list.length === 0
            ? html`<div class="empty">${c.filter().trim()
                ? html`No images match “${c.filter()}”.`
                : html`No local images yet — pull one above to get started.`}</div>`
            : html`<div class="list">${list.map((img) => {
                const inUse = used.has(img.tags[0] ?? '');
                const [name, tag] = (img.tags[0] ?? '<none>:<none>').split(':');
                return html`<div class="row">
                  <span class="chip"><ml-icon icon="cube"></ml-icon></span>
                  <div class="namecol">
                    <div class="tag"><span>${name}</span>${tag ? html`<span class="ver">:${tag}</span>` : html``}</div>
                    <div class="age">${ageLabel(img.created)}</div>
                  </div>
                  <span class=${inUse ? 'use in' : 'use'}>${inUse ? 'in use' : 'unused'}</span>
                  <span class="size">${sizeLabel(img.size)}</span>
                  ${img.tags[0] && !img.tags[0].startsWith('<none>')
                    ? html`
                        <ml-button variant="ghost" size="sm" aria-label="Update (re-pull latest)" title="Update — re-pull this tag" @ml:click=${() => void updateImage(img.tags[0]!)}><ml-icon icon="arrow-clockwise"></ml-icon></ml-button>
                        <ml-button variant="ghost" size="sm" aria-label="Run from this image" title="Run a container" @ml:click=${() => openRun(img.tags[0])}><ml-icon icon="play"></ml-icon></ml-button>`
                    : html``}
                  <ml-button variant="ghost" size="sm" aria-label="Remove image" @ml:click=${() => void removeImage(img.id)}><ml-icon icon="trash"></ml-icon></ml-button>
                </div>`;
              })}</div>`}
      </div>
    `;
  },
  styles: () => css`
    :host { display: block; }
    .wrap { padding: 24px 28px 40px; display: flex; flex-direction: column; gap: 14px; max-width: 860px; }
    .pullbar { display: flex; gap: 10px; max-width: 760px; }
    .pullbar .pull { flex: 1; }
    .filter { max-width: 320px; }
    .empty { display: flex; align-items: center; justify-content: center; min-height: 30vh; color: var(--ev-faint); font-size: 14px; }
    .list { background: var(--ev-bg-2); border: 1px solid var(--ev-border); border-radius: 14px; overflow: hidden; }
    .row { display: flex; align-items: center; gap: 14px; padding: 11px 14px; border-bottom: 1px solid var(--ev-border); }
    .row:last-child { border-bottom: none; }
    .chip { width: 34px; height: 34px; border-radius: 8px; background: var(--ev-surface-2); color: var(--ev-dim); display: inline-flex; align-items: center; justify-content: center; flex: none; }
    .namecol { flex: 1; min-width: 0; }
    .tag { font-family: var(--ml-font-mono); font-size: 13.5px; color: var(--ev-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag .ver { color: var(--ev-accent); }
    .age { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ev-faint); }
    .use { font-family: var(--ml-font-mono); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 20px; }
    .use.in { background: var(--ev-accent-dim); color: var(--ev-accent); }
    .use:not(.in) { background: var(--ev-surface-2); color: var(--ev-faint); border: 1px solid var(--ev-border); }
    .size { font-family: var(--ml-font-mono); font-size: 13px; color: var(--ev-dim); width: 74px; text-align: right; flex: none; }
  `,
})
class ImagesViewComponent {
  images = images; services = services; loading = loading;
  draft = signal(''); filter = signal('');

  // Refresh on every tab open so images pulled outside Envy (CLI, compose) show up.
  onConnect(): void {
    reloadImages().catch(() => { /* Docker offline — keep the last list */ });
  }

  pull = (): void => {
    const v = this.draft().trim();
    if (!v) return;
    void pullImage(v);
    this.draft.set('');
  };
}

export { ImagesViewComponent };
