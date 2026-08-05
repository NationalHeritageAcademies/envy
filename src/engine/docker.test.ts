import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { DockerClient } from './docker.js';

/** Stand-in for dockerode's /events response stream. */
class FakeStream extends EventEmitter {
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

/** A DockerClient whose dockerode handle serves the given event streams,
 *  one per watchEvents() call. */
function clientWithStreams(...streams: FakeStream[]): DockerClient {
  const client = new DockerClient();
  let calls = 0;
  (client as unknown as { docker: { getEvents: () => Promise<FakeStream> } }).docker = {
    getEvents: async () => streams[calls++]!,
  };
  return client;
}

function collectStreamErrors(client: DockerClient): Error[] {
  const errors: Error[] = [];
  client.on('stream-error', (err: Error) => errors.push(err));
  return errors;
}

describe('watchEvents', () => {
  it('emits parsed container events from the stream', async () => {
    const stream = new FakeStream();
    const client = clientWithStreams(stream);
    const events: unknown[] = [];
    client.on('event', (e: unknown) => events.push(e));
    await client.watchEvents();
    stream.emit('data', Buffer.from('{"Type":"container","status":"start"}\n'));
    expect(events).toEqual([{ Type: 'container', status: 'start' }]);
  });

  it('reports a clean end as a stream loss', async () => {
    // A daemon restart / engine idle-stop closes the connection without error;
    // the stream is just as dead as an errored one.
    const stream = new FakeStream();
    const client = clientWithStreams(stream);
    const errors = collectStreamErrors(client);
    await client.watchEvents();
    stream.emit('end');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/ended/);
  });

  it('reports a bare close as a stream loss', async () => {
    const stream = new FakeStream();
    const client = clientWithStreams(stream);
    const errors = collectStreamErrors(client);
    await client.watchEvents();
    stream.emit('close');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/closed/);
  });

  it('reports a loss once even when error is followed by close', async () => {
    const stream = new FakeStream();
    const client = clientWithStreams(stream);
    const errors = collectStreamErrors(client);
    await client.watchEvents();
    stream.emit('error', new Error('boom'));
    stream.emit('close');
    stream.emit('end');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('boom');
  });

  it('re-arming destroys the old stream without reporting its loss', async () => {
    // resume() calls watchEvents() again after an outage; the superseded
    // stream's death must not re-trigger the reconnect machinery.
    const first = new FakeStream();
    const second = new FakeStream();
    const client = clientWithStreams(first, second);
    const errors = collectStreamErrors(client);
    await client.watchEvents();
    await client.watchEvents();
    expect(first.destroyed).toBe(true);
    expect(errors).toHaveLength(0);
    second.emit('end'); // the live stream still reports
    expect(errors).toHaveLength(1);
  });
});
