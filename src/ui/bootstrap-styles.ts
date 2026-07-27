// Inject the Melodic component stylesheet + Envy tokens at runtime (not via
// index.html) so Vite's HTML plugin doesn't inline/rewrite them and strip the
// `melodic-styles` attribute that gets the rules adopted into each component's
// shadow root. Same approach Coax uses; see its bootstrap-styles for the full
// rationale on the file:// and Vite failure modes this avoids.

const stylesheets = [
  './melodic-components.css', // copied to renderer root by viteStaticCopy
  './tokens.css', // copied verbatim from src/ui/public
];

for (const href of stylesheets) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('melodic-styles', '');
  link.href = href;
  document.head.appendChild(link);
}
