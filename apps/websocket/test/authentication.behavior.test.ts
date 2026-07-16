import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';
import { handleConnection } from '../src/handlers/connection.js';

const secret = 'phase-1-behavior-test-secret';
const server = createServer();
const wss = new WebSocketServer({ server });
let url: string;

before(async () => {
  process.env['JWT_SECRET'] = secret;
  wss.on('connection', handleConnection);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  url = `ws://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  delete process.env['JWT_SECRET'];
});

test('accepts a valid token and rejects an invalid token', async () => {
  const validClient = new WebSocket(url);
  await once(validClient, 'open');
  const authenticated = once(validClient, 'message');
  validClient.send(
    JSON.stringify({
      type: 'authenticate',
      payload: { token: jwt.sign({ userId: randomUserId(), role: 'player' }, secret) },
      timestamp: Date.now(),
    })
  );
  const [validMessage] = await authenticated;
  assert.equal(JSON.parse(validMessage.toString()).type, 'authenticated');
  validClient.close();
  await once(validClient, 'close');

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

const randomUserId = () => crypto.randomUUID();
