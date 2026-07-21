import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import bcrypt from 'bcrypt';
import { inArray } from 'drizzle-orm';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { users } from '../../src/lib/db/schema/users.js';
import { loginUser, registerUser } from '../../src/services/auth.service.js';

const createdUserIds: string[] = [];

before(async () => {
  await runMigrations();
  await initDb();
});

after(async () => {
  if (createdUserIds.length > 0) {
    await getDb().delete(users).where(inArray(users.id, createdUserIds));
  }
  await closeDb();
});

test('registration stores a password hash and login accepts the original password', async () => {
  const suffix = randomUUID();
  const password = 'correct horse battery staple';
  const user = await registerUser(`auth-${suffix}`, `auth-${suffix}@example.test`, password);
  createdUserIds.push(user.id);

  const [stored] = await getDb()
    .select()
    .from(users)
    .where(inArray(users.id, [user.id]));
  assert.ok(stored);
  assert.notEqual(stored.passwordHash, password);
  assert.equal(await bcrypt.compare(password, stored.passwordHash), true);

  const loggedIn = await loginUser(user.email, password);
  assert.equal(loggedIn.id, user.id);
  assert.equal('passwordHash' in loggedIn, false);
});

test('registration rejects duplicate email addresses and usernames', async () => {
  const suffix = randomUUID();
  const user = await registerUser(
    `duplicate-${suffix}`,
    `duplicate-${suffix}@example.test`,
    'secret'
  );
  createdUserIds.push(user.id);

  await assert.rejects(
    registerUser(`other-${suffix}`, user.email, 'secret'),
    isAppError(ErrorCode.ALREADY_EXISTS)
  );
  await assert.rejects(
    registerUser(user.username, `other-${suffix}@example.test`, 'secret'),
    isAppError(ErrorCode.ALREADY_EXISTS)
  );
});

test('login rejects a wrong password and an inactive account', async () => {
  const suffix = randomUUID();
  const password = 'secret-password';
  const user = await registerUser(
    `inactive-${suffix}`,
    `inactive-${suffix}@example.test`,
    password
  );
  createdUserIds.push(user.id);

  await assert.rejects(
    loginUser(user.email, 'wrong-password'),
    isAppError(ErrorCode.INVALID_CREDENTIALS)
  );

  await getDb()
    .update(users)
    .set({ status: 'inactive' })
    .where(inArray(users.id, [user.id]));
  await assert.rejects(loginUser(user.email, password), isAppError(ErrorCode.FORBIDDEN));
});

function isAppError(code: ErrorCode) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}
