import { buildApp } from '../../src/app.js';

export const buildTestApp = () =>
  buildApp({ jwtSecret: 'integration-test-secret', logger: false, realtime: false });

export function authHeaders(app: Awaited<ReturnType<typeof buildApp>>, userId: string) {
  return {
    authorization: `Bearer ${app.jwt.sign({ userId, role: 'player' })}`,
  };
}
