import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { rendererTestProviders } from '../test-setup';
import { UiStateService } from './ui-state.service';

describe('UiStateService', () => {
	function setup(): UiStateService {
		TestBed.configureTestingModule({ providers: rendererTestProviders() });
		return TestBed.inject(UiStateService);
	}

	beforeEach(() => {
		localStorage.clear();
	});

	it('opening inspect resets the tab and the drawer confirm', () => {
		const ui = setup();
		ui.setDrawerTab('shell');
		ui.setInspectConfirm(true);

		ui.openInspect('abc123');

		expect(ui.inspect()).toBe('abc123');
		expect(ui.drawerTab()).toBe('logs');
		expect(ui.inspectConfirm()).toBe(false);
	});

	it('toggleGroup flips a project and persists the whole map', () => {
		const ui = setup();
		expect(ui.collapsedGroups()['api']).toBeUndefined();

		ui.toggleGroup('api');
		expect(ui.collapsedGroups()['api']).toBe(true);
		expect(JSON.parse(localStorage.getItem('envy:collapsedGroups') ?? '{}')).toEqual({ api: true });

		ui.toggleGroup('api');
		expect(ui.collapsedGroups()['api']).toBe(false);
	});

	it('the run prefill is consumed once so a later open starts blank', () => {
		const ui = setup();
		ui.openRun('postgres:16');
		expect(ui.runOpen()).toBe(true);

		expect(ui.consumeRunPrefill()).toBe('postgres:16');
		expect(ui.consumeRunPrefill()).toBe('');

		ui.closeRun();
		ui.openRun();
		expect(ui.consumeRunPrefill()).toBe('');
	});
});
