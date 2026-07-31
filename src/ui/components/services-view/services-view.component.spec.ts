import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import type { EngineStatus, ServiceView } from '../../../ipc/contract';
import { DockerStateService } from '../../store/docker-state.service';
import { PROJECT_LABEL, SERVICE_LABEL } from '../../store/model';
import { rendererTestProviders } from '../../test-setup';
import { ServicesViewComponent } from './services-view.component';

function makeService(overrides: Partial<ServiceView> & { id: string }): ServiceView {
	return {
		name: overrides.id,
		image: 'nginx:latest',
		state: 'running',
		status: 'Up 2 minutes',
		running: true,
		ports: [],
		labels: {},
		routes: [],
		domains: ['envy.local'],
		domainsLocked: false,
		...overrides
	};
}

function makeStatus(dockerConnected: boolean): EngineStatus {
	return {
		dataReady: true,
		proxyRunning: false,
		dockerConnected,
		containerIpsRoutable: true,
		config: { domains: ['envy.local'] } as EngineStatus['config'],
		routes: []
	};
}

describe('envy-services-view', () => {
	async function setup(): Promise<{ docker: DockerStateService; detect: () => Promise<void> }> {
		const { fixture } = await render(ServicesViewComponent, { providers: rendererTestProviders() });
		const docker = TestBed.inject(DockerStateService);
		return {
			docker,
			detect: async () => {
				fixture.detectChanges();
				await fixture.whenStable();
			}
		};
	}

	it('offers to start the detected provider when Docker is offline', async () => {
		const { docker, detect } = await setup();
		docker.setLoading(false);
		docker.setStatus(makeStatus(false));
		docker.setProvider({ name: 'OrbStack', startable: true, installed: true });
		await detect();

		expect(screen.getByText('Docker isn’t running')).toBeTruthy();
		expect(screen.getByText('Start OrbStack')).toBeTruthy();
	});

	it('points at an install when no Docker engine is present at all', async () => {
		const { docker, detect } = await setup();
		docker.setLoading(false);
		docker.setStatus(makeStatus(false));
		docker.setProvider({ name: 'Docker Desktop', startable: false, installed: false });
		await detect();

		expect(screen.getByText('Docker isn’t installed')).toBeTruthy();
	});

	it('groups containers by Compose project and labels each with its service name', async () => {
		const { docker, detect } = await setup();
		docker.setLoading(false);
		docker.setStatus(makeStatus(true));
		docker.setServices([
			makeService({ id: 'a', labels: { [PROJECT_LABEL]: 'shop', [SERVICE_LABEL]: 'api' } }),
			makeService({ id: 'b', running: false, labels: { [PROJECT_LABEL]: 'shop', [SERVICE_LABEL]: 'web' } }),
			makeService({ id: 'c', name: 'redis' })
		]);
		await detect();

		expect(screen.getByText('shop')).toBeTruthy();
		expect(screen.getByText('Standalone')).toBeTruthy();
		// Compose members render their service name, standalone ones their own.
		expect(screen.getByText('api')).toBeTruthy();
		expect(screen.getByText('web')).toBeTruthy();
		expect(screen.getByText('redis')).toBeTruthy();
		// One of the two shop services is stopped.
		expect(screen.getByText('1/2')).toBeTruthy();
	});
});
