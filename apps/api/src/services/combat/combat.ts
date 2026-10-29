import {
  required,
  isOneOf,
  AppError,
  defenseUpgradeKeys,
  ErrorCode,
  type CombatReport,
  type DefenseUpgradeKey,
  type ResourceMap,
} from '@orions-frontier/shared';
import {
  calculateBuildingEffect,
  currentIntegrity,
  getSpacecraft,
  integrityWaveDamage,
  requireSpacecraft,
  ATTACK_PROTECTION_DURATION_MS,
} from '@orions-frontier/game-config';
import { getDb, type Tx } from '../../lib/db/index.js';
import {
  findReturningCombatMissionForUpdate,
  findTravelingCombatMissionForUpdate,
  insertCombatMission,
  listCombatMissionsByUser,
  updateCombatMission,
  type CombatMissionRow,
} from '../../repositories/combat-missions.js';
import { insertTrip, updateTripCargo, type TripRow } from '../../repositories/spacecraft-trips.js';
import { findBuildingLevel, listBuildingLevels } from '../../repositories/station-buildings.js';
import {
  deductStationResource,
  listStationResourcesInKeyOrderForUpdate,
} from '../../repositories/station-resources.js';
import {
  listStationSpacecraftIdsByKeys,
  listStationSpacecraftsForUpdate,
  releaseSpacecraft,
  removeLockedSpacecraft,
  removeSpacecraft,
  reserveSpacecraft,
} from '../../repositories/station-spacecrafts.js';
import {
  findActiveStation,
  findOwnedStationForUpdate,
  findStation,
  findStationForUpdate,
  updateStation,
} from '../../repositories/stations.js';
import { findUserForUpdate, updateUser } from '../../repositories/users.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { createDebrisFromLosses } from './salvage.js';
import { destroyStation } from './destruction.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { getUserScannerCoverages, isPointVisible } from '../map/index.js';
import { calculateStationDefenseScore, creditStationResources } from '../station/index.js';
import { applyVectorNavigation, effectiveAttackPower } from '../research/index.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import {
  completionEventId,
  discardedResources,
  type PlaytestCompletionEvent,
} from '../../lib/completion-events.js';

type Trip = TripRow;

const toReport = (
  row: CombatMissionRow,
  defenderUserId: string,
  arrivesAt: Date,
  viewerUserId: string
): CombatReport => {
  // The defender learns the composition of an incoming attack only when it arrives.
  const hidden = row.status === 'traveling' && viewerUserId !== row.userId;
  return {
    id: row.id,
    attackerStationId: row.attackerStationId,
    defenderStationId: row.defenderStationId,
    attackerUserId: row.userId,
    defenderUserId,
    attackerFleet: hidden ? null : row.attackerFleet,
    attackerAmount: hidden ? null : row.attackerAmount,
    attackerLosses: row.attackerLosses,
    defenderLosses: row.defenderLosses,
    winner: row.winner,
    loot: row.loot ?? {},
    integrityDamage: row.integrityDamage,
    defenderIntegrity: row.defenderIntegrity,
    stationDestroyed: row.stationDestroyed,
    status: row.status,
    arrivesAt: arrivesAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
};

/** Protection ends 24h after registration or at the renewed end after a restart. */
export const protectionEndsAt = (user: { createdAt: Date; protectedUntil: Date | null }) =>
  new Date(
    Math.max(
      user.createdAt.getTime() + ATTACK_PROTECTION_DURATION_MS,
      user.protectedUntil?.getTime() ?? 0
    )
  );

export async function startAttack(params: {
  userId: string;
  stationId: string;
  targetStationId: string;
  /** Ships per spacecraft key; fighters and bombers travel together. */
  fleet: Record<string, number>;
  now?: Date;
  context?: GameExecutionContext;
}): Promise<CombatReport> {
  const groups = Object.entries(params.fleet)
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (groups.length === 0 || groups.some(([, amount]) => !Number.isInteger(amount) || amount < 1)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
  }
  const spacecraftByKey = new Map(groups.map(([key]) => [key, getSpacecraft(key)]));
  for (const spacecraft of spacecraftByKey.values()) {
    if (!spacecraft || !['fighter', 'bomber'].includes(spacecraft.role) || spacecraft.speed <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Selected spacecraft cannot attack');
    }
  }
  const slowest = groups.reduce((best, group) =>
    (spacecraftByKey.get(group[0])?.speed ?? 0) < (spacecraftByKey.get(best[0])?.speed ?? 0)
      ? group
      : best
  );
  const totalAmount = groups.reduce((sum, [, amount]) => sum + amount, 0);
  const context = resolveGameExecutionContext(params.context ?? params.now);
  const db = getDb();
  const mission = await db.transaction(async (tx) => {
    const attacker = await findOwnedStationForUpdate(tx, params.stationId, params.userId);
    if (!attacker) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const defender = await findActiveStation(tx, params.targetStationId);
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
      findUserForUpdate(tx, required(sortedIds[0], 'sortedIds[0]')),
      findUserForUpdate(tx, required(sortedIds[1], 'sortedIds[1]')),
    ]);
    const attUser = sortedIds[0] === params.userId ? userA : userB;
    const defUser = sortedIds[0] === defenderUserId ? userA : userB;

    // Check if defender is still protected
    if (defUser) {
      if (now < protectionEndsAt(defUser) && !defUser.attackProtectionBrokenAt) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target account is protected from attacks');
      }
    }

    const rows = await listStationSpacecraftIdsByKeys(
      tx,
      attacker.id,
      groups.map(([key]) => key)
    );
    const rowIdByKey = new Map(rows.map((row) => [row.spacecraftKey, row.id]));
    // All groups lock in one transaction, in key order; one short group aborts the whole attack.
    for (const [key, amount] of groups) {
      const rowId = rowIdByKey.get(key);
      const locked = rowId ? await reserveSpacecraft(tx, rowId, amount) : false;
      if (!locked) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Not enough spacecraft available');
      }
    }

    // Mark attacker's protection as broken if still active
    if (attUser && !attUser.attackProtectionBrokenAt) {
      await updateUser(tx, params.userId, { attackProtectionBrokenAt: now });
    }

    const departedAt = context.now;
    const baseArrivesAt = calcArrivesAt(
      departedAt,
      calcDistance(attacker, defender),
      requireSpacecraft(slowest[0]).speed
    );
    const arrivesAt = await applyVectorNavigation(tx, attacker.id, baseArrivesAt, departedAt);
    const tripId = await insertTrip(tx, {
      id: context.nextId('trip'),
      stationSpacecraftId: required(rowIdByKey.get(slowest[0]), 'slowest group'),
      groupSize: totalAmount,
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
    });
    const created = await insertCombatMission(tx, {
      id: context.nextId('combat-mission'),
      userId: params.userId,
      attackerStationId: attacker.id,
      defenderStationId: defender.id,
      outboundTripId: tripId,
      attackerFleet: Object.fromEntries(groups),
      attackerAmount: totalAmount,
      createdAt: context.now,
    });
    return { mission: created, defenderUserId: defender.userId, arrivesAt };
  });
  publishUserEvent(mission.defenderUserId, 'incoming_attack', {
    missionId: mission.mission.id,
    defenderStationId: mission.mission.defenderStationId,
    arrivesAt: mission.arrivesAt.toISOString(),
  });
  return toReport(mission.mission, mission.defenderUserId, mission.arrivesAt, params.userId);
}

export async function getUserCombatReports(
  userId: string,
  options: { since?: Date } = {}
): Promise<CombatReport[]> {
  const rows = await listCombatMissionsByUser(getDb(), userId, options.since);
  return rows.map(({ mission, defenderUserId, arrivesAt }) =>
    toReport(mission, defenderUserId, arrivesAt, userId)
  );
}

async function buildingLevel(tx: Tx, stationId: string, buildingKey: string): Promise<number> {
  return (await findBuildingLevel(tx, stationId, buildingKey)) ?? 0;
}

async function stationDefenseScore(tx: Tx, stationId: string): Promise<number> {
  const rows = await listBuildingLevels(tx, stationId);

  const levels: Partial<Record<DefenseUpgradeKey, number>> = {};
  for (const row of rows) {
    if (isOneOf(defenseUpgradeKeys, row.buildingKey)) {
      levels[row.buildingKey] = row.level;
    }
  }
  return calculateStationDefenseScore(levels);
}

/** Attacking groups with their station fleet rows, slowest first. */
async function attackerGroups(tx: Tx, stationId: string, fleet: Record<string, number>) {
  const keys = Object.keys(fleet);
  const rows = keys.length === 0 ? [] : await listStationSpacecraftIdsByKeys(tx, stationId, keys);
  return rows
    .map((row) => ({
      rowId: row.id,
      key: row.spacecraftKey,
      amount: fleet[row.spacecraftKey] ?? 0,
      spacecraft: requireSpacecraft(row.spacecraftKey),
    }))
    .filter((group) => group.amount > 0)
    .sort((a, b) => a.spacecraft.speed - b.spacecraft.speed || a.key.localeCompare(b.key));
}

async function resolveOutboundCombat(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<PlaytestCompletionEvent[]> {
  const mission = await findTravelingCombatMissionForUpdate(tx, trip.id);
  if (!mission) return [];

  // The station lock serializes simultaneous waves, so integrity and destruction apply once.
  const defenderStation = await findStationForUpdate(tx, mission.defenderStationId);
  if (!defenderStation) throw new Error('Combat station no longer exists');

  const groups = await attackerGroups(tx, mission.attackerStationId, mission.attackerFleet);
  const survivors = new Map(groups.map((group) => [group.key, group.amount]));
  let attackerLosses = 0;
  let defenderLosses = 0;
  let winner: 'attacker' | 'defender' | null = null;
  let integrityDamage = 0;
  let defenderIntegrity: number | null = null;
  let stationDestroyed = false;
  const loot: Record<string, number> = {};
  const destroyed = new Map<string, number>();
  const debrisResources: ResourceMap = {};

  // A wave that arrives at a destroyed station finds nothing to fight and turns around.
  if (!defenderStation.destroyedAt) {
    const defenderRows = await listStationSpacecraftsForUpdate(tx, mission.defenderStationId);
    const defenderFleets = defenderRows
      .map((fleet) => ({ ...fleet, defense: requireSpacecraft(fleet.spacecraftKey).defense }))
      .sort((a, b) => a.defense - b.defense || a.id.localeCompare(b.id));
    const defenderFleetPower = defenderFleets.reduce(
      (sum, fleet) => sum + Math.max(0, fleet.amount - fleet.lockedAmount) * fleet.defense,
      0
    );
    const defenderPower =
      defenderFleetPower + (await stationDefenseScore(tx, mission.defenderStationId));
    let attackerPower = 0;
    for (const group of groups) {
      attackerPower +=
        group.amount *
        (await effectiveAttackPower(tx, mission.attackerStationId, group.spacecraft.attack));
    }
    const attackerDefense = groups.reduce(
      (sum, group) => sum + group.amount * Math.max(1, group.spacecraft.defense),
      0
    );
    // Every group loses the same share, so bombers are neither shielded nor singled out.
    const lossShare = Math.min(1, defenderPower / Math.max(1, attackerDefense));
    for (const group of groups) {
      const losses = Math.floor(group.amount * lossShare);
      if (losses === 0) continue;
      attackerLosses += losses;
      survivors.set(group.key, group.amount - losses);
      destroyed.set(group.key, losses);
      await removeLockedSpacecraft(tx, group.rowId, losses);
    }
    const survivorTotal = [...survivors.values()].reduce((sum, amount) => sum + amount, 0);

    let remainingDamage = attackerPower;
    for (const fleet of defenderFleets) {
      const losses = Math.min(
        Math.max(0, fleet.amount - fleet.lockedAmount),
        Math.floor(remainingDamage / Math.max(1, fleet.defense))
      );
      if (losses === 0) continue;
      defenderLosses += losses;
      destroyed.set(fleet.spacecraftKey, (destroyed.get(fleet.spacecraftKey) ?? 0) + losses);
      remainingDamage -= losses * Math.max(1, fleet.defense);
      await removeSpacecraft(tx, fleet.id, losses);
    }

    winner = survivorTotal > 0 && attackerPower > defenderPower ? 'attacker' : 'defender';
    if (winner === 'attacker') {
      let cargoLeft = groups.reduce(
        (sum, group) => sum + (survivors.get(group.key) ?? 0) * group.spacecraft.cargo,
        0
      );
      const warehouseLevel = await buildingLevel(tx, mission.defenderStationId, 'warehouse');
      const protectedAmount =
        calculateBuildingEffect('warehouse', warehouseLevel).find(
          (effect) => effect.type === 'protected_storage'
        )?.value ?? 0;
      const resources = await listStationResourcesInKeyOrderForUpdate(
        tx,
        mission.defenderStationId
      );
      for (const resource of resources) {
        if (cargoLeft <= 0) break;
        const available = Math.max(0, resource.amount - protectedAmount);
        const amount = Math.min(cargoLeft, Math.floor(available * 0.1));
        if (amount <= 0) continue;
        loot[resource.resourceKey] = amount;
        cargoLeft -= amount;
        await deductStationResource(tx, mission.defenderStationId, resource.resourceKey, amount);
      }
    }

    const survivingBombers = groups
      .filter((group) => group.spacecraft.role === 'bomber')
      .reduce((sum, group) => sum + (survivors.get(group.key) ?? 0), 0);
    const integrityBefore = currentIntegrity(
      defenderStation.integrity,
      defenderStation.integrityUpdatedAt,
      trip.arrivesAt
    );
    integrityDamage = winner === 'attacker' ? integrityWaveDamage(survivingBombers) : 0;
    defenderIntegrity = Math.max(0, integrityBefore - integrityDamage);
    if (integrityDamage > 0) {
      await updateStation(tx, defenderStation.id, {
        integrity: defenderIntegrity,
        integrityUpdatedAt: trip.arrivesAt,
      });
    }
    if (defenderIntegrity === 0) {
      stationDestroyed = true;
      const remains = await destroyStation(tx, defenderStation, context);
      for (const [key, amount] of remains.dockedShips) {
        destroyed.set(key, (destroyed.get(key) ?? 0) + amount);
      }
      Object.assign(debrisResources, remains.resources);
    }
  }

  const debris = await createDebrisFromLosses(
    tx,
    mission.defenderStationId,
    destroyed,
    context,
    debrisResources
  );
  const survivorFleet = Object.fromEntries(survivors);
  const survivorCount = [...survivors.values()].reduce((sum, amount) => sum + amount, 0);
  const events: PlaytestCompletionEvent[] = [
    {
      type: 'combat_resolved',
      eventId: completionEventId('combat_resolved', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.attackerStationId,
      missionId: mission.id,
      defenderStationId: mission.defenderStationId,
      winner: winner ?? 'none',
      attackerLosses,
      defenderLosses,
      integrityDamage,
      defenderIntegrity,
      stationDestroyed,
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

  const outcome = {
    attackerSurvivors: survivorFleet,
    attackerLosses,
    defenderLosses,
    winner,
    loot,
    integrityDamage,
    defenderIntegrity,
    stationDestroyed,
  };
  const returning = groups.find((group) => (survivors.get(group.key) ?? 0) > 0);
  if (!returning) {
    await updateCombatMission(tx, mission.id, {
      ...outcome,
      status: 'resolved',
      resolvedAt: trip.arrivesAt,
    });
    return events;
  }

  const attackerStation = await findStation(tx, mission.attackerStationId);
  if (!attackerStation) throw new Error('Combat station no longer exists');
  const departedAt = trip.arrivesAt;
  const baseArrivesAt = calcArrivesAt(
    departedAt,
    calcDistance(defenderStation, attackerStation),
    returning.spacecraft.speed
  );
  const arrivesAt = await applyVectorNavigation(
    tx,
    mission.attackerStationId,
    baseArrivesAt,
    departedAt
  );
  const returnTripId = await insertTrip(tx, {
    id: context.nextId('trip'),
    stationSpacecraftId: returning.rowId,
    groupSize: survivorCount,
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
  });
  await updateCombatMission(tx, mission.id, { ...outcome, returnTripId, status: 'returning' });
  return events;
}

async function resolveCombatReturn(tx: Tx, trip: Trip): Promise<PlaytestCompletionEvent[]> {
  const mission = await findReturningCombatMissionForUpdate(tx, trip.id);
  if (!mission) return [];
  const requested = { ...trip.cargoManifest };
  const credited = await creditStationResources(tx, mission.attackerStationId, requested);
  await updateTripCargo(tx, trip.id, credited);
  for (const group of await attackerGroups(
    tx,
    mission.attackerStationId,
    mission.attackerSurvivors ?? {}
  )) {
    await releaseSpacecraft(tx, group.rowId, group.amount);
  }
  await updateCombatMission(tx, mission.id, { status: 'resolved', resolvedAt: trip.arrivesAt });
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
