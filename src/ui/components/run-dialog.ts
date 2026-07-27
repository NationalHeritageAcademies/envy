import { MelodicComponent, html, css, signal } from '@melodicdev/core';
import type { IElementRef, OnCreate } from '@melodicdev/core';
import { runOpen, runPrefillImage, domains } from '../store/state.js';
import { runContainer } from '../store/actions.js';
import type { RunOptions } from '../../ipc/contract.js';

/** The ml-dialog element exposes imperative open/close via `.component`. */
type DialogElement = HTMLElement & { component: { open(): void; close(): void } };

function parsePorts(raw: string): { host: number; container: number }[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const parts = pair.split(':').map((n) => Number.parseInt(n.trim(), 10));
      const host = parts[0];
      return { host, container: parts[1] ?? host };
    })
    .filter((p): p is { host: number; container: number } => Number.isFinite(p.host) && Number.isFinite(p.container));
}
function parseVolumes(raw: string): { source: string; target: string }[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.lastIndexOf(':');
      return idx > 0 ? { source: line.slice(0, idx), target: line.slice(idx + 1) } : null;
    })
    .filter((v): v is { source: string; target: string } => v !== null);
}

@MelodicComponent({
  selector: 'envy-run-dialog',
  template: (c: RunDialogComponent) => html`
    <ml-dialog style="--ml-dialog-max-width: 540px;">
      <div slot="dialog-header" class="hdr"><strong>Run a container</strong></div>

      <div class="form">
        <label><span>Image</span>
          <ml-input placeholder="e.g. postgres:16" .value=${c.image()} @input=${(e: Event) => c.image.set((e.target as HTMLInputElement).value)}></ml-input>
        </label>
        <label><span>Name <em>(optional)</em></span>
          <ml-input placeholder="auto if blank" .value=${c.name()} @input=${(e: Event) => c.name.set((e.target as HTMLInputElement).value)}></ml-input>
        </label>
        <label><span>Hostname <em>(optional)</em></span>
          <ml-input placeholder="defaults to the container name" .value=${c.hostname()} @input=${(e: Event) => c.hostname.set((e.target as HTMLInputElement).value)}></ml-input>
          <small>The subdomain for its URL — e.g. <code>api</code> → <code>api.${c.primary()}</code>.</small>
        </label>
        ${c.domains().length
          ? html`<label><span>Domains</span>
              <div class="dchips">
                ${c.domains().map((d) => {
                  const on = c.domainsSel().has(d);
                  return html`<button type="button" class=${on ? 'dchip on' : 'dchip'} @click=${() => c.toggleDomain(d)}>*.${d}</button>`;
                })}
              </div>
            </label>`
          : html``}
        <label><span>Ports</span>
          <ml-input placeholder="5432:5432, 8080:80" .value=${c.ports()} @input=${(e: Event) => c.ports.set((e.target as HTMLInputElement).value)}></ml-input>
          <small>host:container, comma-separated. The published port becomes the service's URL.</small>
        </label>
        <label><span>Environment</span>
          <ml-textarea rows="3" placeholder="KEY=value&#10;one per line" .value=${c.env()} @input=${(e: Event) => c.env.set((e.target as HTMLTextAreaElement).value)}></ml-textarea>
        </label>
        <label><span>Volumes</span>
          <ml-textarea rows="2" placeholder="pgdata:/var/lib/postgresql/data&#10;/host/path:/in/container" .value=${c.volumes()} @input=${(e: Event) => c.volumes.set((e.target as HTMLTextAreaElement).value)}></ml-textarea>
        </label>
      </div>

      <div slot="dialog-footer" class="ftr">
        <ml-button variant="ghost" @ml:click=${c.cancel}>Cancel</ml-button>
        <ml-button variant="primary" ?disabled=${!c.image().trim() || c.busy()} @ml:click=${c.submit}>
          ${c.busy() ? 'Running…' : 'Run'}
        </ml-button>
      </div>
    </ml-dialog>
  `,
  styles: () => css`
    :host { display: contents; }
    .hdr strong { font-size: 16px; }
    .form { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ev-dim); }
    label span em { color: var(--ev-faint); font-style: normal; }
    label small { font-size: 11.5px; color: var(--ev-faint); }
    label small code { font-family: var(--ml-font-mono); background: var(--ev-surface-2); padding: 1px 5px; border-radius: 5px; }
    .dchips { display: flex; flex-wrap: wrap; gap: 7px; }
    .dchip { font-family: var(--ml-font-mono); font-size: 12px; padding: 6px 11px; border-radius: 8px; cursor: pointer; background: var(--ev-surface-2); border: 1px solid var(--ev-border); color: var(--ev-dim); }
    .dchip.on { background: var(--ev-accent-dim); border-color: rgba(52, 211, 153, 0.3); color: var(--ev-accent); }
    .ftr { display: flex; justify-content: flex-end; gap: 8px; }
  `,
})
class RunDialogComponent implements IElementRef, OnCreate {
  elementRef!: HTMLElement;
  runOpen = runOpen;
  domains = domains;
  image = signal(''); name = signal(''); hostname = signal(''); ports = signal(''); env = signal(''); volumes = signal('');
  domainsSel = signal<Set<string>>(new Set());
  busy = signal(false);

  primary(): string { return this.domains()[0] ?? 'envy'; }

  onCreate(): void {
    // Drive the ml-dialog open/close from the shared signal; reset on open.
    runOpen.subscribe((open) => {
      const d = this.dialog();
      if (open) this.reset();
      if (!d) return;
      if (open) d.open(); else d.close();
    });
  }

  private reset(): void {
    this.image.set(runPrefillImage()); runPrefillImage.set(''); // consume any prefill
    this.name.set(''); this.hostname.set('');
    this.ports.set(''); this.env.set(''); this.volumes.set('');
    this.domainsSel.set(new Set(this.domains().slice(0, 1))); // primary selected
  }

  toggleDomain(d: string): void {
    const next = new Set(this.domainsSel());
    if (next.has(d)) next.delete(d); else next.add(d);
    if (next.size === 0) return; // keep at least one
    this.domainsSel.set(next);
  }

  private dialog(): DialogElement['component'] | undefined {
    return (this.elementRef.shadowRoot?.querySelector('ml-dialog') as DialogElement | null)?.component;
  }

  cancel = (): void => runOpen.set(false);

  private parse(): RunOptions {
    const env = this.env().split('\n').map((s) => s.trim()).filter((l) => l.includes('='));
    const labels: Record<string, string> = {};
    const host = this.hostname().trim();
    if (host) labels['envy.host'] = host;
    // Only set envy.domains when it differs from the default (primary only).
    const sel = [...this.domainsSel()];
    const primary = this.domains()[0];
    if (sel.length && !(sel.length === 1 && sel[0] === primary)) labels['envy.domains'] = sel.join(',');
    return {
      image: this.image().trim(),
      name: this.name().trim() || undefined,
      ports: parsePorts(this.ports()),
      env: env.length ? env : undefined,
      volumes: parseVolumes(this.volumes()),
      labels: Object.keys(labels).length ? labels : undefined,
    };
  }

  submit = async (): Promise<void> => {
    if (!this.image().trim()) return;
    this.busy.set(true);
    try {
      await runContainer(this.parse());
      runOpen.set(false);
    } catch {
      /* toast shown by the action */
    } finally {
      this.busy.set(false);
    }
  };
}

export { RunDialogComponent };
