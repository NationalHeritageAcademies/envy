import { render } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { rendererTestProviders } from '../../../test-setup';
import { IconComponent } from './icon.component';
import { ICON_PATHS } from './icon-set';

describe('ev-icon', () => {
	it('inlines the path data for a known icon at the requested size', async () => {
		const { container } = await render(IconComponent, {
			inputs: { name: 'play', size: 'sm' },
			providers: rendererTestProviders()
		});

		const svg = container.querySelector('svg');
		expect(svg?.getAttribute('width')).toBe('14');
		expect(container.querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.play);
	});

	it('renders nothing for an unknown name rather than an empty box', async () => {
		const { container } = await render(IconComponent, {
			inputs: { name: 'no-such-icon' },
			providers: rendererTestProviders()
		});

		expect(container.querySelector('svg')).toBeNull();
	});
});
