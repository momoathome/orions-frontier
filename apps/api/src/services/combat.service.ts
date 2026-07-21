import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { AppError, ErrorCode, type CombatReport } from '@orions-frontier/shared';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import { getDb } from '../lib/db/index.js';
import { combatMissions } from '../lib/db/schema/combat-missions.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { spacecraftDefinitions } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { calcArrivesAt, calcDistance } from '../lib/travel.js';
import { createDebrisFromLosses } from './salvage.service.js';
import { addStationInfluence } from './influence.service.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Trip = typeof spacecraftTrips.$inferSelect;

const toReport = (row: typeof combatMissions.$inferSelect): CombatReport => ({
  id: row.id,
  attackerStationId: row.attackerStationId,
  defenderStationId: row.defenderStationId,
  attackerAmount: row.attackerAmount,
  attackerLosses: row.attackerLosses,
  defenderLosses: row.defenderLosses,
  winner: row.winner as CombatReport['winner'],
  loot: row.loot ?? {},
  status: row.status as CombatReport['status'],
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
});

export async function startAttack(params: {
  userId: string;
  stationId: string;
  targetStationId: string;
  spacecraftDefinitionId: string;
  amount: number;
}): Promise<CombatReport> {
  if (!Number.isInteger(params.amount) || params.amount < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
  }
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    const [attacker] = await tx
      .select({ id: stations.id, x: stations.x, y: stations.y })
      .from(stations)
      .where(and(eq(stations.id, params.stationId), eq(stations.userId, params.userId)))
      .for('update');
    if (!attacker) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const [defender] = await tx
      .select({ id: stations.id, userId: stations.userId, x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, params.targetStationId))
      .limit(1);
    if (!defender || defender.userId === params.userId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid attack target');
    }

    const [fleet] = await tx
      .select({
        id: stationSpacecrafts.id,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
        attack: spacecraftDefinitions.attack,
        defense: spacecraftDefinitions.defense,
        cargo: spacecraftDefinitions.cargo,
        speed: spacecraftDefinitions.speed,
        role: spacecraftDefinitions.role,
      })
      .from(stationSpacecrafts)
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(stationSpacecrafts.stationId, attacker.id),
          eq(stationSpacecrafts.spacecraftDefinitionId, params.spacecraftDefinitionId)
        )
      )
      .limit(1);
    if (!fleet || fleet.role !== 'fighter' || fleet.speed <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Selected spacecraft cannot attack');
    }
    if (fleet.amount - fleet.lockedAmount < params.amount) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Not enough spacecraft available');
    }
    const [locked] = await tx
      .update(stationSpacecrafts)
      .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${params.amount}` })
      .where(
        and(
          eq(stationSpacecrafts.id, fleet.id),
          sql`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount} >= ${params.amount}`
        )
      )
      .returning({ id: stationSpacecrafts.id });
    if (!locked) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Not enough spacecraft available');

    const departedAt = new Date();
    const arrivesAt = calcArrivesAt(departedAt, calcDistance(attacker, defender), fleet.speed);
    const [trip] = await tx
      .insert(spacecraftTrips)
      .values({
        stationSpacecraftId: fleet.id,
        groupSize: params.amount,
        fromType: 'station',
        fromId: attacker.id,
        toType: 'station',
        toId: defender.id,
        departedAt,
        arrivesAt,
        purpose: 'combat',
      })
      .returning({ id: spacecraftTrips.id });
    const [created] = await tx
      .insert(combatMissions)
      .values({
        userId: params.userId,
        attackerStationId: attacker.id,
        defenderStationId: defender.id,
        attackerStationSpacecraftId: fleet.id,
        outboundTripId: trip!.id,
        attackerAmount: params.amount,
      })
      .returning();
    return created!;
  });
  return toReport(mission);
}

export async function getUserCombatReports(userId: string): Promise<CombatReport[]> {
  const rows = await getDb()
    .select({ mission: combatMissions })
    .from(combatMissions)
    .innerJoin(stations, eq(combatMissions.defenderStationId, stations.id))
    .where(or(eq(combatMissions.userId, userId), eq(stations.userId, userId)))
    .orderBy(desc(combatMissions.createdAt));
  return rows.map(({ mission }) => toReport(mission));
}

async function buildingLevel(tx: Tx, stationId: string, buildingKey: string): Promise<number> {
  const [building] = await tx
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .innerJoin(
      buildingDefinitions,
      eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
    )
    .where(and(eq(stationBuildings.stationId, stationId), eq(buildingDefinitions.key, buildingKey)))
    .limit(1);
  return building?.level ?? 0;
}

async function resolveOutboundCombat(tx: Tx, trip: Trip): Promise<void> {
  const [mission] = await tx
    .select()
    .from(combatMissions)
    .where(and(eq(combatMissions.outboundTripId, trip.id), eq(combatMissions.status, 'traveling')))
    .for('update');
  if (!mission) return;

  const [attackerFleet] = await tx
    .select({
      definitionId: stationSpacecrafts.spacecraftDefinitionId,
      attack: spacecraftDefinitions.attack,
      defense: spacecraftDefinitions.defense,
      cargo: spacecraftDefinitions.cargo,
      speed: spacecraftDefinitions.speed,
    })
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(stationSpacecrafts.id, mission.attackerStationSpacecraftId));
  if (!attackerFleet) throw new Error('Attacking fleet no longer exists');

  const defenderFleets = await tx
    .select({
      id: stationSpacecrafts.id,
      definitionId: stationSpacecrafts.spacecraftDefinitionId,
      amount: stationSpacecrafts.amount,
      lockedAmount: stationSpacecrafts.lockedAmount,
      defense: spacecraftDefinitions.defense,
    })
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(stationSpacecrafts.stationId, mission.defenderStationId))
    .orderBy(asc(spacecraftDefinitions.defense), asc(stationSpacecrafts.id))
    .for('update');
  const guardianLevel = await buildingLevel(tx, mission.defenderStationId, 'guardian');
  const guardianPower =
    calculateBuildingEffect('guardian', guardianLevel).find(
      (effect) => effect.type === 'defense_power'
    )?.value ?? 0;
  const defenderPower =
    defenderFleets.reduce(
      (sum, fleet) => sum + Math.max(0, fleet.amount - fleet.lockedAmount) * fleet.defense,
      0
    ) + guardianPower;
  const attackerPower = mission.attackerAmount * attackerFleet.attack;
  const attackerLosses = Math.min(
    mission.attackerAmount,
    Math.floor(defenderPower / Math.max(1, attackerFleet.defense))
  );
  const survivors = mission.attackerAmount - attackerLosses;

  let remainingDamage = attackerPower;
  let defenderLosses = 0;
  const destroyed = new Map<string, number>();
  if (attackerLosses > 0) destroyed.set(attackerFleet.definitionId, attackerLosses);
  for (const fleet of defenderFleets) {
    const losses = Math.min(
      Math.max(0, fleet.amount - fleet.lockedAmount),
      Math.floor(remainingDamage / Math.max(1, fleet.defense))
    );
    if (losses === 0) continue;
    defenderLosses += losses;
    destroyed.set(fleet.definitionId, (destroyed.get(fleet.definitionId) ?? 0) + losses);
    remainingDamage -= losses * Math.max(1, fleet.defense);
    await tx
      .update(stationSpacecrafts)
      .set({
        amount: sql`${stationSpacecrafts.amount} - ${losses}`,
      })
      .where(eq(stationSpacecrafts.id, fleet.id));
  }

  const winner = survivors > 0 && attackerPower > defenderPower ? 'attacker' : 'defender';
  const loot: Record<string, number> = {};
  if (winner === 'attacker') {
    let cargoLeft = survivors * attackerFleet.cargo;
    const warehouseLevel = await buildingLevel(tx, mission.defenderStationId, 'warehouse');
    const protectedAmount =
      calculateBuildingEffect('warehouse', warehouseLevel).find(
        (effect) => effect.type === 'protected_storage'
      )?.value ?? 0;
    const resources = await tx
      .select()
      .from(stationResources)
      .where(eq(stationResources.stationId, mission.defenderStationId))
      .orderBy(asc(stationResources.resourceKey))
      .for('update');
    for (const resource of resources) {
      const available = Math.max(0, resource.amount - protectedAmount);
      const amount = Math.min(cargoLeft, Math.floor(available * 0.1));
      if (amount <= 0) continue;
      loot[resource.resourceKey] = amount;
      cargoLeft -= amount;
      await tx
        .update(stationResources)
        .set({ amount: sql`${stationResources.amount} - ${amount}` })
        .where(
          and(
            eq(stationResources.stationId, mission.defenderStationId),
            eq(stationResources.resourceKey, resource.resourceKey)
          )
        );
      if (cargoLeft === 0) break;
    }
  }

  await tx
    .update(stationSpacecrafts)
    .set({
      amount: sql`${stationSpacecrafts.amount} - ${attackerLosses}`,
      lockedAmount: sql`${stationSpacecrafts.lockedAmount} - ${attackerLosses}`,
    })
    .where(eq(stationSpacecrafts.id, mission.attackerStationSpacecraftId));

  await createDebrisFromLosses(tx, mission.defenderStationId, destroyed);
  if (winner === 'attacker') {
    await addStationInfluence(tx, mission.userId, mission.defenderStationId);
  }

  if (survivors === 0) {
    await tx
      .update(combatMissions)
      .set({
        attackerLosses,
        defenderLosses,
        winner,
        loot,
        status: 'resolved',
        resolvedAt: trip.arrivesAt,
      })
      .where(eq(combatMissions.id, mission.id));
    return;
  }

  const [attackerStation, defenderStation] = await Promise.all([
    tx
      .select({ x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, mission.attackerStationId))
      .then((rows) => rows[0]),
    tx
      .select({ x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, mission.defenderStationId))
      .then((rows) => rows[0]),
  ]);
  if (!attackerStation || !defenderStation) throw new Error('Combat station no longer exists');
  const departedAt = trip.arrivesAt;
  const arrivesAt = calcArrivesAt(
    departedAt,
    calcDistance(defenderStation, attackerStation),
    attackerFleet.speed
  );
  const [returnTrip] = await tx
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId: mission.attackerStationSpacecraftId,
      groupSize: survivors,
      fromType: 'station',
      fromId: mission.defenderStationId,
      toType: 'station',
      toId: mission.attackerStationId,
      departedAt,
      arrivesAt,
      purpose: 'combat_return',
      cargoManifest: loot,
    })
    .returning({ id: spacecraftTrips.id });
  await tx
    .update(combatMissions)
    .set({
      returnTripId: returnTrip!.id,
      attackerLosses,
      defenderLosses,
      winner,
      loot,
      status: 'returning',
    })
    .where(eq(combatMissions.id, mission.id));
}

async function resolveCombatReturn(tx: Tx, trip: Trip): Promise<void> {
  const [mission] = await tx
    .select()
    .from(combatMissions)
    .where(and(eq(combatMissions.returnTripId, trip.id), eq(combatMissions.status, 'returning')))
    .for('update');
  if (!mission) return;
  for (const [resourceKey, amount] of Object.entries(trip.cargoManifest ?? {})) {
    if (amount <= 0) continue;
    await tx
      .insert(stationResources)
      .values({ stationId: mission.attackerStationId, resourceKey, amount })
      .onConflictDoUpdate({
        target: [stationResources.stationId, stationResources.resourceKey],
        set: { amount: sql`${stationResources.amount} + ${amount}` },
      });
  }
  await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} - ${trip.groupSize}` })
    .where(eq(stationSpacecrafts.id, mission.attackerStationSpacecraftId));
  await tx
    .update(combatMissions)
    .set({ status: 'resolved', resolvedAt: trip.arrivesAt })
    .where(eq(combatMissions.id, mission.id));
}

export async function handleCombatTripArrival(tx: Tx, trip: Trip): Promise<void> {
  if (trip.purpose === 'combat') await resolveOutboundCombat(tx, trip);
  else if (trip.purpose === 'combat_return') await resolveCombatReturn(tx, trip);
}
