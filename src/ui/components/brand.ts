import { html } from '@melodicdev/core';
import type { TemplateResult } from '@melodicdev/core';

/**
 * The Envy brand mark — a glowing emerald eye ("green with envy"). Reproduced
 * from the design handoff: a soft accent halo, a radial-gradient iris, a dark
 * pupil, and a white catchlight, with a green drop-shadow glow.
 */
export function envyEye(size = 30): TemplateResult {
  return html`
    <svg
      width=${size}
      height=${size}
      viewBox="0 0 40 40"
      fill="none"
      style="filter:drop-shadow(0 0 7px rgba(52,211,153,0.45));"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="18.5" fill="#34d399" opacity="0.16" />
      <circle cx="20" cy="20" r="11.5" fill="url(#evIris)" />
      <circle cx="20" cy="20" r="4.7" fill="#04130c" />
      <circle cx="16.6" cy="16.4" r="1.8" fill="#eafff5" opacity="0.92" />
      <defs>
        <radialGradient id="evIris" cx="40%" cy="36%" r="72%">
          <stop offset="0%" stop-color="#aef7d6" />
          <stop offset="52%" stop-color="#34d399" />
          <stop offset="100%" stop-color="#0b7a54" />
        </radialGradient>
      </defs>
    </svg>
  `;
}
