// FIRST import on purpose: registers the global error net before any component
// module evaluates, so an import-time throw shows a fallback instead of black.
import { fail } from './error-net';

import './bootstrap-styles';

// xterm's stylesheet has to be global, not a component style: xterm builds its
// own DOM imperatively after the view is created, so those nodes never get the
// _ngcontent attribute that emulated encapsulation scopes rules by. See
// shell-term.component.ts.
import '@xterm/xterm/css/xterm.css';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => fail('bootstrap', err));
