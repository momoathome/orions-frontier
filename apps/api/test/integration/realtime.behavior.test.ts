import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { WebSocket } from 'ws';
import { attachRealtimeServer, publishUserEvent } from '../../src/lib/realtime.js';

const secret = 'realtime-behavior-test-secret';
const userId = crypto.randomUUID();
const app = Fastify();
let url: string;

before(async () => {
  await app.register(fastifyJwt, { secret });
  attachRealtimeServer(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  url = address.replace('http://', 'ws://');
});

after(async () => {
  await app.close();
});

test('authenticates clients and sends user events from the API process', async () => {
  const client = new WebSocket(url);
  await once(client, 'open');
  const authenticated = once(client, 'message');
  client.send(
    JSON.stringify({
      type: 'authenticate',
      payload: { token: app.jwt.sign({ userId, role: 'player' }) },
      timestamp: Date.now(),
    })
  );
  const [authMessage] = await authenticated;
  assert.equal(JSON.parse(authMessage.toString()).type, 'authenticated');

  const event = once(client, 'message');
  publishUserEvent(userId, 'transport_tick_completed', { settled: 1 });
  const [eventMessage] = await event;
  assert.deepEqual(JSON.parse(eventMessage.toString()).payload, { settled: 1 });
  client.close();
  await once(client, 'close');

  const invalidClient = new WebSocket(url);
  await once(invalidClient, 'open');
  const rejected = once(invalidClient, 'close');
  invalidClient.send(
    JSON.stringify({
      type: 'authenticate',
      payload: { token: 'invalid' },
      timestamp: Date.now(),
    })
  );
  const [code] = await rejected;
  assert.equal(code, 4401);
});
