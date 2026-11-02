import {
  required,
  AppError,
  ErrorCode,
  type AttackForecast,
  type CombatReport,
  type ResourceMap,
} from '@orions-frontier/shared';
import {
  calculateProtectedStorage,
  coarseIntegrity,
  currentIntegrity,
  getSpacecraft,
  integrityWaveDamage,
  isAttackProtected,
  requireSpacecraft,
} from '@orions-frontier/game-config';
import { getDb, type Tx } from '../../lib/db/index.js';
import {
  findReturningCombatMissionForUpdate,
  findTravelingCombatMissionForUpdate,
  insertCombatMission,
  listCombatMissionsByUser,
  updateCombatMission,
  type CombatMissionRow,
} from './repositories/combat-missions.js';
import { insertTrip, updateTripCargo, type TripRow } from '../fleet/index.js';
import { findUserForUpdate, updateUser } from '../auth/index.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { lootFromStock, resolveBattle } from './battle.js';
import { forecastAttack } from './forecast.js';
import { createDebrisFromLosses } from './salvage.js';
import { destroyStation } from './destruction.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { isPointVisible } from '../map/index.js';
import {
  creditStationResources,
  getStationDefenseScore,
  findBuildingLevel,
  deductStationResource,
  listStationResourcesInKeyOrderForUpdate,
  listStationSpacecraftIdsByKeys,
  listStationSpacecraftsForUpdate,
  releaseSpacecraft,
  removeLockedSpacecraft,
  removeSpacecraft,
  reserveSpacecraft,
  findActiveStation,
  findOwnedStation,
  findOwnedStationForUpdate,
  findStation,
  findStationForUpdate,
  updateStation,
  getStationVisualProfiles,
  getUserScannerCoverages,
  listStationResources,
} from '../station/index.js';
import {
  applyTravelSpeed,
  getResearchModifiers,
  getStationResearchModifiers,
} from '../research/index.js';
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
  viewerUserId: string,
  signatureAnalysis: boolean
): CombatReport => {
  // The defender learns the composition only from a battle (winner set), or earlier with Signature Analysis.
  const hidden = row.winner === null && viewerUserId !== row.userId && !signatureAnalysis;
  // Outsiders learn the integrity only from a wave that hit it, and then in coarse tiers.
  const defenderIntegrity =
    row.defenderIntegrity === null || viewerUserId === defenderUserId
      ? row.defenderIntegrity
      : row.integrityDamage > 0
        ? coarseIntegrity(row.defenderIntegrity)
        : null;
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
    defenderIntegrity,
    stationDestroyed: row.stationDestroyed,
    status: row.status,
    arrivesAt: arrivesAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
};

/** Validates the requested ships: groups in key order, the slowest key and the total amount. */
function parseAttackFleet(fleet: Record<string, number>) {
  const groups = Object.entries(fleet)
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
  const [slowestKey] = groups.reduce((best, group) =>
    (spacecraftByKey.get(group[0])?.speed ?? 0) < (spacecraftByKey.get(best[0])?.speed ?? 0)
      ? group
      : best
  );
  const totalAmount = groups.reduce((sum, [, amount]) => sum + amount, 0);
  return { groups, slowestKey, totalAmount };
}

/**
 * Locks both accounts, rejects a protected defender and ends the attacker's own protection. The
 * user rows lock in stable ID order to prevent deadlocks.
 */
async function lockUsersAndCheckProtection(
  tx: Tx,
  attackerUserId: string,
  defenderUserId: string,
  now: Date
) {
  const sortedIds = [attackerUserId, defenderUserId].sort();
  const [userA, userB] = await Promise.all([
    findUserForUpdate(tx, required(sortedIds[0], 'sortedIds[0]')),
    findUserForUpdate(tx, required(sortedIds[1], 'sortedIds[1]')),
  ]);
  const attUser = sortedIds[0] === attackerUserId ? userA : userB;
  const defUser = sortedIds[0] === defenderUserId ? userA : userB;
  if (defUser && isAttackProtected(defUser, now)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Target account is protected from attacks');
  }
  if (attUser && !attUser.attackProtectionBrokenAt) {
    await updateUser(tx, attackerUserId, { attackProtectionBrokenAt: now });
  }
}

export async function startAttack(params: {
  userId: string;
  stationId: string;
  targetStationId: string;
  /** Ships per spacecraft key; fighters and bombers travel together. */
  fleet: Record<string, number>;
  now?: Date;
  context?: GameExecutionContext;
}): Promise<CombatReport> {
  const { groups, slowestKey, totalAmount } = parseAttackFleet(params.fleet);
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
    await lockUsersAndCheckProtection(tx, params.userId, defender.userId, context.now);

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

    const departedAt = context.now;
    const baseArrivesAt = calcArrivesAt(
      departedAt,
      calcDistance(attacker, defender),
      requireSpacecraft(slowestKey).speed
    );
    const arrivesAt = await applyTravelSpeed(tx, attacker.id, baseArrivesAt, departedAt);
    const tripId = await insertTrip(tx, {
      id: context.nextId('trip'),
      stationSpacecraftId: required(rowIdByKey.get(slowestKey), 'slowest group'),
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
  return toReport(mission.mission, mission.defenderUserId, mission.arrivesAt, params.userId, false);
}

/** What the scanner lets the attacker expect from this fleet; changes nothing. */
export async function getAttackForecast(params: {
  userId: string;
  stationId: string;
  targetStationId: string;
  fleet: Record<string, number>;
}): Promise<AttackForecast> {
  const { groups } = parseAttackFleet(params.fleet);
  const db = getDb();
  const attacker = await findOwnedStation(db, params.stationId, params.userId);
  if (!attacker) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
  const defender = await findActiveStation(db, params.targetStationId);
  if (!defender || defender.userId === params.userId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid attack target');
  }
  const coverages = await getUserScannerCoverages(params.userId, db);
  if (!isPointVisible(coverages, defender)) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Target station not found');
  }
  const [profiles, research, warehouseLevel, resources] = await Promise.all([
    getStationVisualProfiles([defender.id]),
    getStationResearchModifiers(db, attacker.id),
    findBuildingLevel(db, defender.id, 'warehouse'),
    listStationResources(db, defender.id),
  ]);
  return forecastAttack(
    groups.map(([key, amount]) => ({ key, amount, spacecraft: requireSpacecraft(key) })),
    required(profiles.get(defender.id), 'target profile'),
    research,
    { resources, protectedAmount: calculateProtectedStorage(warehouseLevel ?? 0) }
  );
}

/** Newest first, one page at a time; incoming attacks are always on the first page. */
export async function getUserCombatReports(
  userId: string,
  { since, limit = 100, offset = 0 }: { since?: Date; limit?: number; offset?: number } = {}
): Promise<CombatReport[]> {
  const db = getDb();
  const [rows, modifiers] = await Promise.all([
    listCombatMissionsByUser(db, userId, { since, limit, offset }),
    getResearchModifiers(userId, db),
  ]);
  return rows.map(({ mission, defenderUserId, arrivesAt }) =>
    toReport(mission, defenderUserId, arrivesAt, userId, modifiers.signatureAnalysis)
  );
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

type AttackerGroup = Awaited<ReturnType<typeof attackerGroups>>[number];

interface CombatOutcome {
  attackerSurvivors: Record<string, number>;
  attackerLosses: number;
  defenderLosses: number;
  winner: 'attacker' | 'defender' | null;
  loot: Record<string, number>;
  integrityDamage: number;
  defenderIntegrity: number | null;
  stationDestroyed: boolean;
}

/** Plunders the defender in key order; see `lootFromStock`. */
async function plunderStation(
  tx: Tx,
  defenderStationId: string,
  cargoCapacity: number
): Promise<Record<string, number>> {
  const protectedAmount = calculateProtectedStorage(
    (await findBuildingLevel(tx, defenderStationId, 'warehouse')) ?? 0
  );
  const resources = await listStationResourcesInKeyOrderForUpdate(tx, defenderStationId);
  const loot = lootFromStock(resources, protectedAmount, cargoCapacity);
  for (const { resourceKey } of resources) {
    const amount = loot[resourceKey];
    if (amount) await deductStationResource(tx, defenderStationId, resourceKey, amount);
  }
  return loot;
}

/** Surviving bombers of a won wave lower the integrity; at 0 the station is destroyed. */
async function damageStation(
  tx: Tx,
  defenderStation: { id: string; userId: string; integrity: number; integrityUpdatedAt: Date },
  survivingBombers: number,
  winner: 'attacker' | 'defender',
  at: Date,
  context: GameExecutionContext
) {
  const integrityBefore = currentIntegrity(
    defenderStation.integrity,
    defenderStation.integrityUpdatedAt,
    at
  );
  const integrityDamage = winner === 'attacker' ? integrityWaveDamage(survivingBombers) : 0;
  const defenderIntegrity = Math.max(0, integrityBefore - integrityDamage);
  if (integrityDamage > 0) {
    await updateStation(tx, defenderStation.id, {
      integrity: defenderIntegrity,
      integrityUpdatedAt: at,
    });
  }
  const stationDestroyed = defenderIntegrity === 0;
  const remains = stationDestroyed ? await destroyStation(tx, defenderStation, context) : null;
  return { integrityDamage, defenderIntegrity, stationDestroyed, remains };
}

function combatEvents(
  mission: CombatMissionRow,
  defenderUserId: string,
  at: Date,
  outcome: CombatOutcome,
  debris: { id: string; resources: ResourceMap } | null
): PlaytestCompletionEvent[] {
  const base = {
    occurredAt: at,
    userId: mission.userId,
    stationId: mission.attackerStationId,
    missionId: mission.id,
  };
  const { attackerLosses, defenderLosses } = outcome;
  const events: PlaytestCompletionEvent[] = [
    {
      ...base,
      type: 'combat_resolved',
      eventId: completionEventId('combat_resolved', mission.id),
      defenderStationId: mission.defenderStationId,
      defenderUserId,
      winner: outcome.winner ?? 'none',
      attackerLosses,
      defenderLosses,
      integrityDamage: outcome.integrityDamage,
      defenderIntegrity: outcome.defenderIntegrity,
      stationDestroyed: outcome.stationDestroyed,
      targetVisibilityVerified: true,
    },
  ];
  if (Object.keys(outcome.loot).length > 0) {
    events.push({
      ...base,
      type: 'loot_acquired',
      eventId: completionEventId('loot_acquired', mission.id),
      resources: outcome.loot,
    });
  }
  if (attackerLosses + defenderLosses > 0) {
    events.push({
      ...base,
      type: 'fleet_losses',
      eventId: completionEventId('fleet_losses', mission.id),
      attackerLosses,
      defenderLosses,
    });
  }
  if (debris) {
    events.push({
      ...base,
      type: 'debris_created',
      eventId: completionEventId('debris_created', mission.id),
      debrisId: debris.id,
      resources: debris.resources,
    });
  }
  return events;
}

/** Survivors fly home together at the speed of the slowest surviving group, carrying the loot. */
async function sendSurvivorsHome(
  tx: Tx,
  mission: CombatMissionRow,
  defenderStation: { x: number; y: number },
  slowest: AttackerGroup,
  outcome: CombatOutcome,
  departedAt: Date,
  context: GameExecutionContext
): Promise<string> {
  const attackerStation = await findStation(tx, mission.attackerStationId);
  if (!attackerStation) throw new Error('Combat station no longer exists');
  const baseArrivesAt = calcArrivesAt(
    departedAt,
    calcDistance(defenderStation, attackerStation),
    slowest.spacecraft.speed
  );
  const arrivesAt = await applyTravelSpeed(
    tx,
    mission.attackerStationId,
    baseArrivesAt,
    departedAt
  );
  return insertTrip(tx, {
    id: context.nextId('trip'),
    stationSpacecraftId: slowest.rowId,
    groupSize: Object.values(outcome.attackerSurvivors).reduce((sum, amount) => sum + amount, 0),
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
    cargoManifest: outcome.loot,
    createdAt: departedAt,
  });
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
  const destroyed = new Map<string, number>();
  const addDestroyed = (key: string, amount: number) =>
    destroyed.set(key, (destroyed.get(key) ?? 0) + amount);
  const outcome: CombatOutcome = {
    attackerSurvivors: {},
    attackerLosses: 0,
    defenderLosses: 0,
    winner: null,
    loot: {},
    integrityDamage: 0,
    defenderIntegrity: null,
    stationDestroyed: false,
  };
  let debrisResources: ResourceMap = {};

  // A wave that arrives at a destroyed station finds nothing to fight and turns around.
  if (!defenderStation.destroyedAt) {
    const [attackerResearch, defenderResearch] = await Promise.all([
      getStationResearchModifiers(tx, mission.attackerStationId),
      getStationResearchModifiers(tx, mission.defenderStationId),
    ]);
    const defenderRows = await listStationSpacecraftsForUpdate(tx, mission.defenderStationId);
    const battle = resolveBattle(
      groups,
      defenderRows,
      await getStationDefenseScore(tx, mission.defenderStationId),
      attackerResearch,
      defenderResearch
    );
    outcome.winner = battle.winner;
    for (const group of groups) {
      const losses = battle.attackerLosses.get(group.key) ?? 0;
      if (losses === 0) continue;
      outcome.attackerLosses += losses;
      survivors.set(group.key, group.amount - losses);
      addDestroyed(group.key, losses);
      await removeLockedSpacecraft(tx, group.rowId, losses);
    }
    for (const [rowId, losses] of battle.defenderLosses) {
      const row = required(
        defenderRows.find((candidate) => candidate.id === rowId),
        'defender fleet'
      );
      outcome.defenderLosses += losses;
      addDestroyed(row.spacecraftKey, losses);
      await removeSpacecraft(tx, rowId, losses);
    }

    if (outcome.winner === 'attacker') {
      // Whole units only: Cargo Compression makes the capacity fractional, resources are bigint.
      const cargoCapacity = Math.floor(
        groups.reduce(
          (sum, group) =>
            sum + (survivors.get(group.key) ?? 0) * group.spacecraft.cargo * attackerResearch.cargo,
          0
        )
      );
      outcome.loot = await plunderStation(tx, mission.defenderStationId, cargoCapacity);
    }

    const survivingBombers = groups
      .filter((group) => group.spacecraft.role === 'bomber')
      .reduce((sum, group) => sum + (survivors.get(group.key) ?? 0), 0);
    const damage = await damageStation(
      tx,
      defenderStation,
      survivingBombers,
      outcome.winner,
      trip.arrivesAt,
      context
    );
    outcome.integrityDamage = damage.integrityDamage;
    outcome.defenderIntegrity = damage.defenderIntegrity;
    outcome.stationDestroyed = damage.stationDestroyed;
    if (damage.remains) {
      for (const [key, amount] of damage.remains.dockedShips) addDestroyed(key, amount);
      debrisResources = damage.remains.resources;
    }
  }

  const debris = await createDebrisFromLosses(
    tx,
    defenderStation,
    destroyed,
    context,
    debrisResources
  );
  outcome.attackerSurvivors = Object.fromEntries(survivors);
  const events = combatEvents(mission, defenderStation.userId, trip.arrivesAt, outcome, debris);

  const slowest = groups.find((group) => (survivors.get(group.key) ?? 0) > 0);
  if (!slowest) {
    await updateCombatMission(tx, mission.id, {
      ...outcome,
      status: 'resolved',
      resolvedAt: trip.arrivesAt,
    });
    return events;
  }
  const returnTripId = await sendSurvivorsHome(
    tx,
    mission,
    defenderStation,
    slowest,
    outcome,
    trip.arrivesAt,
    context
  );
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
