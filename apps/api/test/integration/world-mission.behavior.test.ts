import assert from 'node:assert/strict';
import { entriesOf } from '@orions-frontier/shared';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  COLONIZATION_COST,
  calculateColonizationCost,
  getSpacecraft,
} from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { worldMissions } from '../../src/lib/db/schema/world-missions.js';
import { WORLD_CONFIG } from '../../src/lib/world-config.js';
import { calcDistance, calcTravelHours } from '../../src/lib/travel.js';
import { ensureSector } from '../../src/services/map/sector.js';
import { createStation } from '../../src/services/station/station.js';
import { lockUserWorldMissions } from '../../src/services/missions/repositories/world-missions.js';
import {
  completeDueWorldMissions,
  getFrontierTargets,
  startColonization,
  startExpedition,
} from '../../src/services/missions/world-mission.js';

import { deleteTestData, grantResearch } from '../helpers/fixtures.js';

const userId = randomUUID();
const secondUserId = randomUUID();
const botUserId = randomUUID();
const sectorIds: string[] = [];
let originStationId = '';
let secondStationId = '';
let botStationId = '';

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  const suffix = randomUUID();
  await db.insert(users).values([
    {
      id: userId,
      username: `mission-${suffix}`,
      email: `mission-${suffix}@example.test`,
      passwordHash: 'not-used',
    },
    {
      id: secondUserId,
      username: `mission2-${suffix}`,
      email: `mission2-${suffix}@example.test`,
      passwordHash: 'not-used',
    },
    {
      id: botUserId,
      username: `mission-bot-${suffix}`,
      email: `mission-bot-${suffix}@example.test`,
      passwordHash: 'not-used',
      role: 'bot',
    },
  ]);
  const expansion = { long_range_survey: 1, colony_logistics: 3, frontier_charter: 2 };
  await Promise.all([userId, secondUserId, botUserId].map((id) => grantResearch(id, expansion)));
  const settlement = await db.transaction((tx) => ensureSector(tx, 100, 100, 'settlement'));
  sectorIds.push(settlement.id);
  const station = await createStation(userId, {
    name: 'Mission Origin',
    sectorId: settlement.id,
  });
  originStationId = station.id;
  secondStationId = (
    await createStation(secondUserId, {
      name: 'Second Explorer',
      sectorId: settlement.id,
    })
  ).id;
  botStationId = (
    await createStation(botUserId, {
      name: 'Bot Explorer',
      slotType: 'bot',
      sectorId: settlement.id,
    })
  ).id;
});

after(async () => {
  await deleteTestData({ userIds: [userId, secondUserId, botUserId], sectorIds });
  await closeDb();
});

test('expeditions use the global frontier and are independent of scanner range', async () => {
  const farSector = await getDb().transaction((tx) => ensureSector(tx, 103, 100, 'frontier'));
  sectorIds.push(farSector.id);
  const mission = await startExpedition({
    userId,
    stationId: originStationId,
    sectorX: 104,
    sectorY: 100,
  });
  assert.equal(mission.targetSectorX, 104);
  await getDb().delete(worldMissions).where(eq(worldMissions.id, mission.id));
  await getDb()
    .update(stationSpacecrafts)
    .set({ lockedAmount: 0 })
    .where(eq(stationSpacecrafts.stationId, originStationId));
});

test('simultaneous expeditions discover their shared target sector once', async () => {
  const missions = await Promise.all([
    startExpedition({ userId, stationId: originStationId, sectorX: 100, sectorY: 101 }),
    startExpedition({
      userId: secondUserId,
      stationId: secondStationId,
      sectorX: 100,
      sectorY: 101,
    }),
  ]);
  const now = new Date(Math.max(...missions.map((mission) => Date.parse(mission.arrivesAt))) + 1);
  const completed = await Promise.all([
    completeDueWorldMissions(now),
    completeDueWorldMissions(now),
  ]);
  assert.equal(
    completed.reduce((sum, result) => sum + result.completed, 0),
    2
  );

  const discovered = await getDb()
    .select({ id: sectors.id })
    .from(sectors)
    .where(and(eq(sectors.sectorX, 100), eq(sectors.sectorY, 101)));
  assert.equal(discovered.length, 1);
  sectorIds.push(discovered[0]!.id);

  const returning = await getDb()
    .select({ arrivesAt: worldMissions.arrivesAt, status: worldMissions.status })
    .from(worldMissions)
    .where(
      inArray(
        worldMissions.id,
        missions.map((mission) => mission.id)
      )
    );
  assert.ok(returning.every((mission) => mission.status === 'returning'));
  assert.equal(
    (
      await completeDueWorldMissions(
        new Date(Math.max(...returning.map((mission) => mission.arrivesAt.getTime())) + 1)
      )
    ).completed,
    2
  );
});

test('active colonization missions reserve their target position', async () => {
  const db = getDb();
  for (const [resourceKey, amount] of entriesOf(COLONIZATION_COST)) {
    await db
      .update(stationResources)
      .set({ amount })
      .where(
        and(
          eq(stationResources.stationId, originStationId),
          eq(stationResources.resourceKey, resourceKey)
        )
      );
  }

  const reservation = await startColonization({
    userId,
    stationId: originStationId,
    sectorX: 100,
    sectorY: 101,
    name: 'Reserved Position',
  });
  let secondMissionId: string | undefined;

  try {
    assert.notEqual(reservation.targetX, null);
    assert.notEqual(reservation.targetY, null);
    const [secondShip] = await db
      .select({ id: stationSpacecrafts.id })
      .from(stationSpacecrafts)
      .where(eq(stationSpacecrafts.stationId, secondStationId));
    await db
      .update(worldMissions)
      .set({
        userId: secondUserId,
        originStationId: secondStationId,
        stationSpacecraftId: secondShip!.id,
        arrivesAt: new Date('2100-01-01T00:00:00Z'),
      })
      .where(eq(worldMissions.id, reservation.id));
    await db
      .update(stationSpacecrafts)
      .set({ lockedAmount: 0 })
      .where(eq(stationSpacecrafts.stationId, originStationId));

    for (const [resourceKey, amount] of entriesOf(COLONIZATION_COST)) {
      await db
        .update(stationResources)
        .set({ amount })
        .where(
          and(
            eq(stationResources.stationId, originStationId),
            eq(stationResources.resourceKey, resourceKey)
          )
        );
    }
    const mission = await startColonization({
      userId,
      stationId: originStationId,
      sectorX: 100,
      sectorY: 101,
      name: 'Clear Position',
    });
    secondMissionId = mission.id;

    assert.ok(
      calcDistance(
        { x: reservation.targetX!, y: reservation.targetY! },
        { x: mission.targetX!, y: mission.targetY! }
      ) >=
        WORLD_CONFIG.SECTOR.SAFE_SPAWN_RADIUS * 2
    );
  } finally {
    await db.delete(worldMissions).where(
      inArray(
        worldMissions.id,
        [reservation.id, secondMissionId].filter((id) => id !== undefined)
      )
    );
    await db
      .update(stationSpacecrafts)
      .set({ lockedAmount: 0 })
      .where(eq(stationSpacecrafts.stationId, originStationId));
  }
});

test('a colony in flight raises the price of the next one', async () => {
  const db = getDb();
  for (const [resourceKey, amount] of entriesOf(COLONIZATION_COST)) {
    await db
      .update(stationResources)
      .set({ amount })
      .where(
        and(
          eq(stationResources.stationId, originStationId),
          eq(stationResources.resourceKey, resourceKey)
        )
      );
  }
  const before = await getFrontierTargets(userId, originStationId);
  const mission = await startColonization({
    userId,
    stationId: originStationId,
    sectorX: 100,
    sectorY: 101,
    name: 'Priced Colony',
  });
  try {
    const after = await getFrontierTargets(userId, originStationId);
    assert.deepEqual(
      after.colonization.cost,
      calculateColonizationCost(before.colonization.stations + 1)
    );
  } finally {
    await db.delete(worldMissions).where(eq(worldMissions.id, mission.id));
    await db
      .update(stationSpacecrafts)
      .set({ lockedAmount: 0 })
      .where(eq(stationSpacecrafts.stationId, originStationId));
  }
});

test('expedition returns and colonization transfers a miner to the second station', async () => {
  const db = getDb();
  const expedition = await startExpedition({
    userId,
    stationId: originStationId,
    sectorX: 101,
    sectorY: 100,
  });
  assert.equal(expedition.missionType, 'expedition');
  assert.equal(
    (await completeDueWorldMissions(new Date(new Date(expedition.arrivesAt).getTime() + 1)))
      .completed,
    1
  );

  const [returningExpedition] = await db
    .select({ arrivesAt: worldMissions.arrivesAt, status: worldMissions.status })
    .from(worldMissions)
    .where(eq(worldMissions.id, expedition.id));
  assert.equal(returningExpedition?.status, 'returning');
  assert.equal(
    (await completeDueWorldMissions(new Date(returningExpedition.arrivesAt.getTime() + 1)))
      .completed,
    1
  );

  const [frontier] = await db
    .select({ id: sectors.id, role: sectors.role })
    .from(sectors)
    .where(and(eq(sectors.sectorX, 101), eq(sectors.sectorY, 100)));
  assert.equal(frontier?.role, 'frontier');
  sectorIds.push(frontier.id);

  for (const [resourceKey, amount] of entriesOf(COLONIZATION_COST)) {
    await db
      .update(stationResources)
      .set({ amount })
      .where(
        and(
          eq(stationResources.stationId, originStationId),
          eq(stationResources.resourceKey, resourceKey)
        )
      );
  }
  const colonization = await startColonization({
    userId,
    stationId: originStationId,
    sectorX: 101,
    sectorY: 100,
    name: 'Second Station',
  });
  assert.equal(
    (await completeDueWorldMissions(new Date(new Date(colonization.arrivesAt).getTime() + 1)))
      .completed,
    1
  );

  const ownedStations = await db.select().from(stations).where(eq(stations.userId, userId));
  assert.equal(ownedStations.length, 2);
  const colony = ownedStations.find((station) => station.id !== originStationId)!;
  const [resources, ships] = await Promise.all([
    db.select().from(stationResources).where(eq(stationResources.stationId, colony.id)),
    db.select().from(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, colony.id)),
  ]);
  assert.ok(resources.every((resource) => resource.amount === 0));
  assert.equal(ships.length, 1);

  const [colonizationMission] = await db
    .select({ spacecraftKey: worldMissions.spacecraftKey })
    .from(worldMissions)
    .where(eq(worldMissions.id, colonization.id));
  assert.equal(ships[0]?.spacecraftKey, colonizationMission?.spacecraftKey);
  assert.equal(ships[0]?.amount, 1);
  assert.equal(ships[0].lockedAmount, 0);

  const [originShip] = await db
    .select({
      amount: stationSpacecrafts.amount,
      lockedAmount: stationSpacecrafts.lockedAmount,
    })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, originStationId));
  assert.deepEqual(originShip, { amount: 2, lockedAmount: 0 });
});

test('bot expedition and colonization use the same travel and resource rules', async () => {
  const db = getDb();
  const expedition = await startExpedition({
    userId: botUserId,
    stationId: botStationId,
    sectorX: 102,
    sectorY: 100,
  });
  const [[station], [mission]] = await Promise.all([
    db.select({ x: stations.x, y: stations.y }).from(stations).where(eq(stations.id, botStationId)),
    db
      .select({ spacecraftKey: worldMissions.spacecraftKey })
      .from(worldMissions)
      .where(eq(worldMissions.id, expedition.id)),
  ]);
  const target = {
    x: 102 * WORLD_CONFIG.SECTOR.WIDTH,
    y: 100 * WORLD_CONFIG.SECTOR.HEIGHT,
  };
  const actualTravelHours =
    (Date.parse(expedition.arrivesAt) - Date.parse(expedition.departedAt)) / 3_600_000;
  assert.ok(
    Math.abs(
      actualTravelHours -
        calcTravelHours(
          calcDistance(station!, target),
          getSpacecraft(mission!.spacecraftKey)!.speed
        )
    ) <
      1 / 3_600_000
  );

  await completeDueWorldMissions(new Date(Date.parse(expedition.arrivesAt) + 1));
  const [returning] = await db
    .select({ arrivesAt: worldMissions.arrivesAt })
    .from(worldMissions)
    .where(eq(worldMissions.id, expedition.id));
  await completeDueWorldMissions(new Date(returning!.arrivesAt.getTime() + 1));

  const [frontier] = await db
    .select({ id: sectors.id })
    .from(sectors)
    .where(and(eq(sectors.sectorX, 102), eq(sectors.sectorY, 100)));
  sectorIds.push(frontier!.id);
  for (const [resourceKey, amount] of entriesOf(COLONIZATION_COST)) {
    await db
      .update(stationResources)
      .set({ amount })
      .where(
        and(
          eq(stationResources.stationId, botStationId),
          eq(stationResources.resourceKey, resourceKey)
        )
      );
  }

  const colonization = await startColonization({
    userId: botUserId,
    stationId: botStationId,
    sectorX: 102,
    sectorY: 100,
    name: 'Bot Frontier',
  });
  const remaining = await db
    .select({ resourceKey: stationResources.resourceKey, amount: stationResources.amount })
    .from(stationResources)
    .where(eq(stationResources.stationId, botStationId));
  for (const resourceKey of Object.keys(COLONIZATION_COST)) {
    assert.equal(remaining.find((row) => row.resourceKey === resourceKey)?.amount, 0);
  }

  await completeDueWorldMissions(new Date(Date.parse(colonization.arrivesAt) + 1));
  assert.equal((await db.select().from(stations).where(eq(stations.userId, botUserId))).length, 2);
});

test('a broken world mission is counted as failed without blocking the others', async () => {
  const db = getDb();
  const [ship] = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, secondStationId));
  const arrivesAt = new Date(Date.now() - 1_000);
  const base = {
    userId: secondUserId,
    originStationId: secondStationId,
    stationSpacecraftId: ship!.id,
    spacecraftKey: 'mole',
    targetSectorX: 100,
    targetSectorY: 100,
    departedAt: new Date(arrivesAt.getTime() - 60_000),
    arrivesAt,
  };
  const [broken, healthy] = await db
    .insert(worldMissions)
    .values([
      { ...base, missionType: 'colonization', colonyName: null },
      { ...base, missionType: 'expedition', status: 'returning' },
    ])
    .returning();

  const now = new Date();
  const result = await completeDueWorldMissions(now);
  assert.equal(result.failed, 1);
  const [returned] = await db.select().from(worldMissions).where(eq(worldMissions.id, healthy!.id));
  assert.equal(returned?.status, 'arrived');

  // The broken mission waits 2 s, then 4 s, instead of failing on every tick.
  const failedAt = async (ms: number) =>
    (await completeDueWorldMissions(new Date(now.getTime() + ms))).failed;
  assert.equal(await failedAt(1_000), 0);
  assert.equal(await failedAt(2_000), 1);
  assert.equal(await failedAt(5_000), 0);
  assert.equal(await failedAt(6_000), 1);
  const [retried] = await db.select().from(worldMissions).where(eq(worldMissions.id, broken!.id));
  assert.equal(retried?.settleFailures, 3);
  await db.delete(worldMissions).where(eq(worldMissions.id, broken!.id));
});

test('colonization arrival waits for a start holding the user lock', async () => {
  const db = getDb();
  const frontier = await db.transaction((tx) => ensureSector(tx, 103, 100, 'frontier'));
  sectorIds.push(frontier.id);
  for (const [resourceKey, amount] of entriesOf(COLONIZATION_COST)) {
    await db
      .update(stationResources)
      .set({ amount })
      .where(
        and(
          eq(stationResources.stationId, secondStationId),
          eq(stationResources.resourceKey, resourceKey)
        )
      );
  }
  const start = { userId: secondUserId, stationId: secondStationId, sectorX: 103, sectorY: 100 };
  const colonization = await startColonization({ ...start, name: 'Raced Colony' });
  const colonyStations = () =>
    db
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.userId, secondUserId), eq(stations.sectorId, frontier.id)));

  let release!: () => void;
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => (locked = resolve));
  const holder = db.transaction(async (tx) => {
    await lockUserWorldMissions(tx, secondUserId);
    locked();
    await new Promise<void>((resolve) => (release = resolve));
  });
  await lockTaken;
  const arrival = completeDueWorldMissions(new Date(Date.parse(colonization.arrivesAt) + 1));
  try {
    await sleep(200);
    const [waiting] = await db
      .select({ status: worldMissions.status })
      .from(worldMissions)
      .where(eq(worldMissions.id, colonization.id));
    assert.equal(waiting?.status, 'traveling');
    assert.equal((await colonyStations()).length, 0);
  } finally {
    release();
  }
  await holder;
  await arrival;
  assert.equal((await colonyStations()).length, 1);
  await assert.rejects(startColonization({ ...start, name: 'Second Raced Colony' }), {
    message: 'You already have a station there',
  });
});
