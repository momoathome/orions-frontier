import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { users } from '../../src/lib/db/schema/users.js';
import { buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
const createdUserIds: string[] = [];

before(async () => {
  await runMigrations();
  await initDb();
});

after(async () => {
  if (createdUserIds.length > 0) {
    await getDb().delete(users).where(inArray(users.id, createdUserIds));
  }
  await app.close();
  await closeDb();
});

test('auth endpoints reject invalid and unauthenticated requests', async () => {
  const invalidRegistration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'x', email: 'not-an-email', password: 'short' },
  });
  assert.equal(invalidRegistration.statusCode, 400);
  assert.equal(invalidRegistration.json().error.code, 'VALIDATION_ERROR');

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.json().error.code, 'UNAUTHORIZED');
});

test('a user can register, login and load their authenticated profile', async () => {
  const suffix = randomUUID();
  const credentials = {
    username: `api-${suffix}`,
    email: `api-${suffix}@example.test`,
    password: 'correct-password',
  };
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: credentials,
  });
  assert.equal(registration.statusCode, 201);
  const registered = registration.json();
  createdUserIds.push(registered.user.id);
  assert.equal(registered.user.email, credentials.email);
  assert.equal(typeof registered.token, 'string');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: credentials,
  });
  assert.equal(duplicate.statusCode, 409);

  const wrongPassword = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: credentials.email, password: 'wrong' },
  });
  assert.equal(wrongPassword.statusCode, 400);
  assert.equal(wrongPassword.json().error.code, 'INVALID_CREDENTIALS');

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: credentials.email, password: credentials.password },
  });
  assert.equal(login.statusCode, 200);
  const loggedIn = login.json();
  assert.equal(loggedIn.user.id, registered.user.id);

  const profile = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${loggedIn.token}` },
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().id, registered.user.id);
});

test('a valid token stops working once the account is no longer active', async () => {
  const suffix = randomUUID();
  const registration = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username: `ban-${suffix}`,
      email: `ban-${suffix}@example.test`,
      password: 'correct-password',
    },
  });
  const { token, user } = registration.json();
  createdUserIds.push(user.id);
  const headers = { authorization: `Bearer ${token}` };

  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers })).statusCode, 200);
  await getDb().update(users).set({ status: 'banned' }).where(eq(users.id, user.id));
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers })).statusCode, 401);
});

test('login attempts from one address are rate limited', async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.test', password: 'wrong-password' },
    });
    statuses.push(response.statusCode);
  }
  assert.ok(statuses.includes(429), `expected a 429, got ${statuses.join(', ')}`);
});
