import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { seedAdminUser, seedAsteroidWorld } from '../../src/seed.js';
import { loginUser } from '../../src/services/auth/index.js';
import { deleteTestData } from '../helpers/fixtures.js';

const admins = () => getDb().select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
const sectorIds = async () =>
  (await getDb().select({ id: sectors.id }).from(sectors)).map((sector) => sector.id);

let sectorIdsBefore: string[] = [];

before(async () => {
  await runMigrations();
  await initDb();
  sectorIdsBefore = await sectorIds();
  await seedAsteroidWorld();
});

// Other suites expect the world this test found: an admin's station opens a settlement.
after(async () => {
  await deleteTestData({
    userIds: (await admins()).map((admin) => admin.id),
    sectorIds: (await sectorIds()).filter((id) => !sectorIdsBefore.includes(id)),
  });
  await closeDb();
});

test('the admin account follows the configured credentials without being duplicated', async () => {
  await deleteTestData({ userIds: (await admins()).map((admin) => admin.id) });

  await seedAdminUser('first@orion.test', 'first-password-1');
  const [created] = await admins();
  assert.ok(created);
  await loginUser('first@orion.test', 'first-password-1');

  await seedAdminUser('second@orion.test', 'second-password-2');
  assert.deepEqual(await admins(), [created]);
  await loginUser('second@orion.test', 'second-password-2');
  await assert.rejects(loginUser('second@orion.test', 'first-password-1'));
  await assert.rejects(loginUser('first@orion.test', 'first-password-1'));

  const adminStations = await getDb()
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.userId, created.id));
  assert.equal(adminStations.length, 1);
});
