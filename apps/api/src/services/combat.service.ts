import { and, asc, desc, eq, gte, or, sql } from 'drizzle-orm';
import {
  AppError,
  defenseUpgradeKeys,
  ErrorCode,
  type CombatReport,
  type DefenseUpgradeKey,
} from '@orions-frontier/shared';
import {
  calculateBuildingEffect,
  getSpacecraft,
  ATTACK_PROTECTION_DURATION_MS,
} from '@orions-frontier/game-config';
import { getDb } from '../lib/db/index.js';
import { combatMissions } from '../lib/db/schema/combat-missions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { users } from '../lib/db/schema/users.js';
import { calcArrivesAt, calcDistance } from '../lib/travel.js';
import { createDebrisFromLosses } from './salvage.service.js';
import { getUserScannerCoverages, isPointVisible } from './scanner-visibility.service.js';
import { calculateStationDefenseScore } from './defense.service.js';
import { creditStationResources } from './station-resource.service.js';
import { effectiveAttackPower, applyVectorNavigation } from './research-effects.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../lib/game-execution-context.js';
import {
  completionEventId,
  discardedResources,
  type PlaytestCompletionEvent,
} from '../lib/playtest/events.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Trip = typeof spacecraftTrips.$inferSelect;

const toReport = (
  row: typeof combatMissions.$inferSelect,
  defenderUserId: string
): CombatReport => ({
  id: row.id,
  attackerStationId: row.attackerStationId,
  defenderStationId: row.defenderStationId,
  attackerUserId: row.userId,
  defenderUserId,
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
  spacecraftKey: string;
  amount: number;
  now?: Date;
  context?: GameExecutionContext;
}): Promise<CombatReport> {
  if (!Number.isInteger(params.amount) || params.amount < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
  }
  const context = resolveGameExecutionContext(params.context ?? params.now);
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    const [attacker] = await tx
      .select({ id: stations.id, userId: stations.userId, x: stations.x, y: stations.y })
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
    const coverages = await getUserScannerCoverages(params.userId, tx);
    if (!isPointVisible(coverages, defender)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Target station not found');
    }

    // Lock both user rows in stable ID order to prevent deadlocks
    const { now } = context;
    const defenderUserId = defender.userId;
    const sortedIds = [params.userId, defenderUserId].sort();
    const [userA, userB] = await Promise.all([
      tx
        .select()
        .from(users)
        .where(eq(users.id, sortedIds[0]!))
        .for('update')
        .then((rows) => rows[0]),
      tx
        .select()
        .from(users)
        .where(eq(users.id, sortedIds[1]!))
        .for('update')
        .then((rows) => rows[0]),
    ]);
    const attUser = sortedIds[0] === params.userId ? userA : userB;
    const defUser = sortedIds[0] === defenderUserId ? userA : userB;

    // Check if defender is still protected
    if (defUser) {
      const protectionEnd = new Date(defUser.createdAt.getTime() + ATTACK_PROTECTION_DURATION_MS);
      if (now < protectionEnd && !defUser.attackProtectionBrokenAt) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target account is protected from attacks');
      }
    }

    const [fleet] = await tx
      .select({
        id: stationSpacecrafts.id,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
        spacecraftKey: stationSpacecrafts.spacecraftKey,
      })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, attacker.id),
          eq(stationSpacecrafts.spacecraftKey, params.spacecraftKey)
        )
      )
      .limit(1);
    const spacecraft = fleet ? getSpacecraft(fleet.spacecraftKey) : undefined;
    if (!fleet || !spacecraft || spacecraft.role !== 'fighter' || spacecraft.speed <= 0) {
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

    // Mark attacker's protection as broken if still active
    if (attUser && !attUser.attackProtectionBrokenAt) {
      await tx
        .update(users)
        .set({ attackProtectionBrokenAt: now })
        .where(eq(users.id, params.userId));
    }

    const departedAt = context.now;
    const baseArrivesAt = calcArrivesAt(
      departedAt,
      calcDistance(attacker, defender),
      spacecraft.speed
    );
    const arrivesAt = await applyVectorNavigation(tx, attacker.id, baseArrivesAt, departedAt);
    const [trip] = await tx
      .insert(spacecraftTrips)
      .values({
        id: context.nextId('trip'),
        stationSpacecraftId: fleet.id,
        groupSize: params.amount,
        fromType: 'station',
        fromId: attacker.id,
        fromX: attacker.x,
        fromY: attacker.y,
        toType: 'station',
        toId: defender.id,
        toX: defender.x,
        toY: defender.y,
        departedAt,
        arrivesAt,
        purpose: 'combat',
        createdAt: context.now,
      })
      .returning({ id: spacecraftTrips.id });
    const [created] = await tx
      .insert(combatMissions)
      .values({
        id: context.nextId('combat-mission'),
        userId: params.userId,
        attackerStationId: attacker.id,
        defenderStationId: defender.id,
        attackerStationSpacecraftId: fleet.id,
        outboundTripId: trip!.id,
        attackerAmount: params.amount,
        createdAt: context.now,
      })
      .returning();
    return { mission: created!, defenderUserId: defender.userId };
  });
  return toReport(mission.mission, mission.defenderUserId);
}

export async function getUserCombatReports(
  userId: string,
  options: { since?: Date } = {}
): Promise<CombatReport[]> {
  const rows = await getDb()
    .select({ mission: combatMissions, defenderUserId: stations.userId })
    .from(combatMissions)
    .innerJoin(stations, eq(combatMissions.defenderStationId, stations.id))
    .where(
      and(
        or(eq(combatMissions.userId, userId), eq(stations.userId, userId)),
        options.since ? gte(combatMissions.createdAt, options.since) : undefined
      )
    )
    .orderBy(desc(combatMissions.createdAt));
  return rows.map(({ mission, defenderUserId }) => toReport(mission, defenderUserId));
}

async function buildingLevel(tx: Tx, stationId: string, buildingKey: string): Promise<number> {
  const [building] = await tx
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, buildingKey))
    )
    .limit(1);
  return building?.level ?? 0;
}

async function stationDefenseScore(tx: Tx, stationId: string): Promise<number> {
  const rows = await tx
    .select({
      buildingKey: stationBuildings.buildingKey,
      level: stationBuildings.level,
    })
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId));

  const levels: Partial<Record<DefenseUpgradeKey, number>> = {};
  for (const row of rows) {
    if ((defenseUpgradeKeys as readonly string[]).includes(row.buildingKey)) {
      levels[row.buildingKey as DefenseUpgradeKey] = row.level;
    }
  }
  return calculateStationDefenseScore(levels);
}

async function resolveOutboundCombat(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<PlaytestCompletionEvent[]> {
  const [mission] = await tx
    .select()
    .from(combatMissions)
    .where(and(eq(combatMissions.outboundTripId, trip.id), eq(combatMissions.status, 'traveling')))
    .for('update');
  if (!mission) return [];

  const [attackerFleet] = await tx
    .select({
      spacecraftKey: stationSpacecrafts.spacecraftKey,
    })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, mission.attackerStationSpacecraftId));
  if (!attackerFleet) throw new Error('Attacking fleet no longer exists');
  const attacker = getSpacecraft(attackerFleet.spacecraftKey)!;

  const defenderRows = await tx
    .select({
      id: stationSpacecrafts.id,
      spacecraftKey: stationSpacecrafts.spacecraftKey,
      amount: stationSpacecrafts.amount,
      lockedAmount: stationSpacecrafts.lockedAmount,
    })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, mission.defenderStationId))
    .for('update');
  const defenderFleets = defenderRows
    .map((fleet) => ({ ...fleet, defense: getSpacecraft(fleet.spacecraftKey)!.defense }))
    .sort((a, b) => a.defense - b.defense || a.id.localeCompare(b.id));
  const defenderFleetPower = defenderFleets.reduce(
    (sum, fleet) => sum + Math.max(0, fleet.amount - fleet.lockedAmount) * fleet.defense,
    0
  );
  const defenderPower =
    defenderFleetPower + (await stationDefenseScore(tx, mission.defenderStationId));
  const effectiveAttack = await effectiveAttackPower(
    tx,
    mission.attackerStationId,
    attacker.attack
  );
  const attackerPower = mission.attackerAmount * effectiveAttack;
  const attackerLosses = Math.min(
    mission.attackerAmount,
    Math.floor(defenderPower / Math.max(1, attacker.defense))
  );
  const survivors = mission.attackerAmount - attackerLosses;

  let remainingDamage = attackerPower;
  let defenderLosses = 0;
  const destroyed = new Map<string, number>();
  if (attackerLosses > 0) destroyed.set(attackerFleet.spacecraftKey, attackerLosses);
  for (const fleet of defenderFleets) {
    const losses = Math.min(
      Math.max(0, fleet.amount - fleet.lockedAmount),
      Math.floor(remainingDamage / Math.max(1, fleet.defense))
    );
    if (losses === 0) continue;
    defenderLosses += losses;
    destroyed.set(fleet.spacecraftKey, (destroyed.get(fleet.spacecraftKey) ?? 0) + losses);
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
    let cargoLeft = survivors * attacker.cargo;
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

  const debris = await createDebrisFromLosses(tx, mission.defenderStationId, destroyed, context);
  const events: PlaytestCompletionEvent[] = [
    {
      type: 'combat_resolved',
      eventId: completionEventId('combat_resolved', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.attackerStationId,
      missionId: mission.id,
      defenderStationId: mission.defenderStationId,
      winner,
      attackerLosses,
      defenderLosses,
      targetVisibilityVerified: true,
    },
  ];
  if (Object.keys(loot).length > 0) {
    events.push({
      type: 'loot_acquired',
      eventId: completionEventId('loot_acquired', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.attackerStationId,
      missionId: mission.id,
      resources: loot,
    });
  }
  if (attackerLosses + defenderLosses > 0) {
    events.push({
      type: 'fleet_losses',
      eventId: completionEventId('fleet_losses', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.attackerStationId,
      missionId: mission.id,
      attackerLosses,
      defenderLosses,
    });
  }
  if (debris) {
    events.push({
      type: 'debris_created',
      eventId: completionEventId('debris_created', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.attackerStationId,
      missionId: mission.id,
      debrisId: debris.id,
      resources: debris.resources,
    });
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
    return events;
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
  const baseArrivesAt = calcArrivesAt(
    departedAt,
    calcDistance(defenderStation, attackerStation),
    attacker.speed
  );
  const arrivesAt = await applyVectorNavigation(
    tx,
    mission.attackerStationId,
    baseArrivesAt,
    departedAt
  );
  const [returnTrip] = await tx
    .insert(spacecraftTrips)
    .values({
      id: context.nextId('trip'),
      stationSpacecraftId: mission.attackerStationSpacecraftId,
      groupSize: survivors,
      fromType: 'station',
      fromId: mission.defenderStationId,
      fromX: defenderStation.x,
      fromY: defenderStation.y,
      toType: 'station',
      toId: mission.attackerStationId,
      toX: attackerStation.x,
      toY: attackerStation.y,
      departedAt,
      arrivesAt,
      purpose: 'combat_return',
      cargoManifest: loot,
      createdAt: departedAt,
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
  return events;
}

async function resolveCombatReturn(tx: Tx, trip: Trip): Promise<PlaytestCompletionEvent[]> {
  const [mission] = await tx
    .select()
    .from(combatMissions)
    .where(and(eq(combatMissions.returnTripId, trip.id), eq(combatMissions.status, 'returning')))
    .for('update');
  if (!mission) return [];
  const requested = { ...((trip.cargoManifest ?? {}) as Record<string, number>) };
  const credited = await creditStationResources(tx, mission.attackerStationId, requested);
  await tx
    .update(spacecraftTrips)
    .set({ cargoManifest: credited })
    .where(eq(spacecraftTrips.id, trip.id));
  await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} - ${trip.groupSize}` })
    .where(eq(stationSpacecrafts.id, mission.attackerStationSpacecraftId));
  await tx
    .update(combatMissions)
    .set({ status: 'resolved', resolvedAt: trip.arrivesAt })
    .where(eq(combatMissions.id, mission.id));
  return [
    {
      type: 'loot_delivered',
      eventId: completionEventId('loot_delivered', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.attackerStationId,
      missionId: mission.id,
      requested,
      credited,
      discarded: discardedResources(requested, credited),
    },
  ];
}

export async function handleCombatTripArrival(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<PlaytestCompletionEvent[]> {
  if (trip.purpose === 'combat') return resolveOutboundCombat(tx, trip, context);
  if (trip.purpose === 'combat_return') return resolveCombatReturn(tx, trip);
  return [];
}
