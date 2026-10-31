import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { combatMissions } from '../../src/lib/db/schema/combat-missions.js';
import { salvageMissions } from '../../src/lib/db/schema/debris-fields.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { runBotDecisionTick } from '../../src/services/bot/bot.js';
import { runSimulationTick } from '../../src/services/simulation/simulation.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  setTestResources,
} from '../helpers/fixtures.js';

before(async () => {
  await runMigrations();
  await initDb();
});

after(async () => {
  await closeDb();
});

test('scenario: a warlord bot raids a neighbour and a bot salvages the debris', async () => {
  const db = getDb();
  const start = new Date();
  const established = new Date(start.getTime() - 48 * 60 * 60_000);
  const [warlord, neighbour, sector] = await Promise.all([
    createTestUser({ createdAt: established }),
    createTestUser({ createdAt: established }),
    createTestSector(),
  ]);
  const origin = sector.sectorX * 10;
  const [raider, target] = await Promise.all([
    createTestStation({ userId: warlord.id, sectorId: sector.id, x: origin, y: origin }),
    createTestStation({ userId: neighbour.id, sectorId: sector.id, x: origin + 50, y: origin }),
  ]);
  await db.insert(stationSpacecrafts).values([
    { stationId: raider.id, spacecraftKey: 'merlin', amount: 6 },
    { stationId: raider.id, spacecraftKey: 'collector', amount: 1 },
  ]);
  await setTestResources(target.id, { carbon: 3_000, titanium: 3_000 });
  await db.insert(botControllers).values({
    userId: warlord.id,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'warlord',
    nextDecisionAt: start,
  });

  let combatResolved = false;
  let salvaged = false;
  // Bots and due work advance together in five-minute steps for up to two virtual days.
  for (let step = 0; step < 576 && !salvaged; step += 1) {
    const now = new Date(start.getTime() + step * 5 * 60_000);
    await runBotDecisionTick(now);
    await runSimulationTick(now);
    const [combat] = await db
      .select({ status: combatMissions.status })
      .from(combatMissions)
      .where(eq(combatMissions.attackerStationId, raider.id));
    combatResolved = combat?.status === 'resolved';
    const [salvage] = await db
      .select({ status: salvageMissions.status })
      .from(salvageMissions)
      .where(eq(salvageMissions.stationId, raider.id));
    salvaged = salvage?.status === 'resolved';
  }

  assert.ok(combatResolved, 'the warlord bot must launch an attack that resolves');
  assert.ok(salvaged, 'the debris from that attack must be salvaged by a bot');

  await deleteTestData({ userIds: [warlord.id, neighbour.id], sectorIds: [sector.id] });
});
