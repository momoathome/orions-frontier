import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AuthenticatedUser, AuthResponse } from '@orions-frontier/shared';
import { useAuthStore } from '../../src/features/auth';

const player: AuthenticatedUser = {
  id: 'user-1',
  username: 'pilot',
  email: 'pilot@example.test',
  role: 'player',
  status: 'active',
  createdAt: new Date('2026-11-01T10:00:00.000Z'),
  updatedAt: new Date('2026-11-01T10:00:00.000Z'),
};

/** Answers each API call in order; the test sees which paths and tokens were used. */
function serveResponses(...responses: { status: number; body: object }[]) {
  const fetchMock = vi.fn((_url: URL, _init: RequestInit) => {
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('unexpected request'));
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const auth = useAuthStore();

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});

afterEach(() => {
  auth.logout();
  vi.unstubAllGlobals();
});

test('login keeps the session for the next page load', async () => {
  const response: AuthResponse = { token: 'token-1', user: player };
  serveResponses({ status: 200, body: response });

  await auth.login({ email: player.email, password: 'correct-password' });

  expect(auth.isAuthenticated).toBe(true);
  expect(localStorage.getItem('auth_token')).toBe('token-1');
});

test('a stored token is sent once and a 401 ends the session', async () => {
  localStorage.setItem('auth_token', 'expired');
  const fetchMock = serveResponses({
    status: 401,
    body: { error: { message: 'Authentication required' } },
  });

  await auth.restoreSession();

  expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({ Authorization: 'Bearer expired' });
  expect(auth.isAuthenticated).toBe(false);
  expect(localStorage.getItem('auth_token')).toBeNull();
});

test('a network error keeps the stored token for the next load', async () => {
  localStorage.setItem('auth_token', 'still-valid');
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

  await auth.restoreSession();

  expect(auth.isAuthenticated).toBe(false);
  expect(localStorage.getItem('auth_token')).toBe('still-valid');
});

test('a failed login shows the server message and stores nothing', async () => {
  serveResponses({ status: 401, body: { error: { message: 'Invalid credentials' } } });

  await expect(auth.login({ email: player.email, password: 'wrong-password' })).rejects.toThrow();

  expect(auth.error).toBe('Invalid credentials');
  expect(localStorage.getItem('auth_token')).toBeNull();
});
