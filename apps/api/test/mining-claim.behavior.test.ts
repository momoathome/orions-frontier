import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../src/lib/db/index.js';
import { runMigrations } from '../src/lib/db/migrate.js';
import { asteroids, asteroidVeins } from '../src/lib/db/schema/asteroids.js';
import { claimMiningCargo } from '../src/services/mining/mining-claim.service.js';

const asteroidId = randomUUID();

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();

  await db
    .insert(asteroids)
    .values({ id: asteroidId, x: 0, y: 0, chunkX: 0, chunkY: 0, size: 'small' });

  await db.insert(asteroidVeins).values([
    {
      asteroidId,
      veinType: 'primary',
      resourceKey: 'carbon',
      remainingAmount: 200,
    },
    {
      asteroidId,
      veinType: 'secondary',
      resourceKey: 'titanium',
      remainingAmount: 50,
    },
  ]);
});

after(async () => {
  const db = getDb();
  await db.delete(asteroids).where(eq(asteroids.id, asteroidId));
  await closeDb();
});

test('concurrent arrivals never claim more than the finite asteroid reserve', async () => {
  const db = getDb();
  const claims = await Promise.all([
    db.transaction((tx) => claimMiningCargo(tx, asteroidId, 200)),
    db.transaction((tx) => claimMiningCargo(tx, asteroidId, 200)),
    db.transaction((tx) => claimMiningCargo(tx, asteroidId, 200)),
  ]);

  assert.deepEqual(
    claims.map((claim) => claim.claimedAmount).sort((a, b) => a - b),
    [0, 50, 200]
  );

  const remaining = await db
    .select({ amount: asteroidVeins.remainingAmount })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId));

  assert.equal(
    remaining.reduce((sum, vein) => sum + vein.amount, 0),
    0
  );
  assert.equal(
    claims.reduce((sum, claim) => sum + claim.claimedAmount, 0),
    250
  );
});
