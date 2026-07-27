// FIRST import on purpose: registers the global error net before any component
// module evaluates, so an import-time throw shows a fallback instead of black.
import { fail } from './error-net.js';

import './bootstrap-styles.js';

// Melodic web components used across the app (side-effect registration).
import '@melodicdev/components/button';
import '@melodicdev/components/icon';
import '@melodicdev/components/input';
import '@melodicdev/components/textarea';
import '@melodicdev/components/badge';
import '@melodicdev/components/spinner';
import '@melodicdev/components/dialog';
import '@melodicdev/components/toggle';
import { applyTheme } from '@melodicdev/components/theme';

// Envy components.
import './components/envy-app.js';
import './components/services-view.js';
import './components/images-view.js';
import './components/domains-view.js';
import './components/activity-view.js';
import './components/inspect-drawer.js';
import './components/run-dialog.js';
import './components/settings-view.js';

import { bootstrap } from './store/actions.js';

// Envy is a dark-first, calm operations surface (per the design system).
applyTheme('dark');

bootstrap().catch((err: unknown) => fail('bootstrap', err));
