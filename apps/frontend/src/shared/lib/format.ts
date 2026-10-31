import { getBuilding, getResearchDefinition } from '@orions-frontier/game-config';
import type {
  BuildingEffectType,
  CostShortfall,
  RequirementBlocker,
  ResearchEffect,
} from '@orions-frontier/shared';
import { resourceName } from './mining-utils';

/** "4:12" or "1:04:12" until the deadline; "0:00" once it passed. */
export function formatCountdown(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = (seconds % 60).toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}

/** Build duration: "45s", "12m 5s", "1h 30m"; fractional seconds are rounded. */
export function formatBuildTime(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Flight and mining spans: "25 min", "3.5 h", "2.1 d"; "—" without a value. */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** Per-hour yield: one decimal below 10, whole numbers above. */
export function formatRate(perHour: number): string {
  return perHour < 10 ? perHour.toFixed(1) : Math.round(perHour).toLocaleString('en-US');
}

/** Compact amount for tight rows: 950, 4.2k, 1.3M. */
export function formatAmount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.floor(value).toString();
}

/** Rough wait for a human reading: "~25 min", "~3 h". */
export function formatWait(hours: number): string {
  if (!Number.isFinite(hours)) return 'unknown';
  if (hours < 1) return `~${Math.max(1, Math.ceil(hours * 60))} min`;
  if (hours < 48) return `~${Math.ceil(hours)} h`;
  return `~${Math.ceil(hours / 24)} d`;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function formatAgo(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1_440)} d ago`;
}

/** "Missing 10 Carbon, affordable in ~2 h" for a cost the station cannot pay yet; null if it can. */
export function formatShortfall(shortfall: CostShortfall): string | null {
  if (shortfall.missing.length === 0) return null;
  const missing = shortfall.missing
    .map((entry) => `${entry.amount.toLocaleString('en-US')} ${resourceName(entry.resourceKey)}`)
    .join(' and ');
  return Number.isFinite(shortfall.hoursUntilAffordable)
    ? `Missing ${missing}, affordable in ${formatWait(shortfall.hoursUntilAffordable)}`
    : `Missing ${missing} and no income of it yet`;
}

/** Label and value of one building effect, e.g. "Capacity" / "6,500". */
export function formatBuildingEffect(
  type: BuildingEffectType,
  value: number
): { label: string; display: string } {
  switch (type) {
    case 'construction_speed':
      return { label: 'Upgrade time', display: value > 0 ? `-${value}%` : '0%' };
    case 'hangar_capacity':
      return { label: 'Crew slots', display: `${value}` };
    case 'production_slots':
      return { label: 'Production slots', display: `${value}` };
    case 'spacecraft_production_bonus':
      return { label: 'Ship build speed', display: `+${value}%` };
    case 'storage_capacity':
      return { label: 'Capacity', display: value.toLocaleString('en-US') };
    case 'protected_storage':
      return { label: 'Protected', display: value.toLocaleString('en-US') };
    case 'scanner_range':
      return { label: 'Scan Range', display: `${value.toLocaleString('en-US')} units` };
    case 'research_speed':
      return { label: 'Research time', display: value > 0 ? `-${value}%` : '0%' };
  }
}

/** Chip text of one missing requirement: "Weapons Technology 2", "Shipyard 3". */
export function formatBlocker(blocker: RequirementBlocker): string {
  switch (blocker.type) {
    case 'maxed':
      return 'Max level';
    case 'research':
      return `${getResearchDefinition(blocker.key)?.name ?? blocker.key} ${blocker.level}`;
    case 'building':
      return `${getBuilding(blocker.key).name} ${blocker.level}`;
    case 'lab_cap':
      return `Laboratory ${blocker.level}`;
  }
}

/** "Requires Laboratory 3 and Sensor Arrays 2", the wording of the server's errors. */
export function formatBlockers(blockers: readonly RequirementBlocker[]): string {
  if (blockers.some((blocker) => blocker.type === 'maxed')) return 'Max level reached';
  const labels = blockers.map(formatBlocker);
  const last = labels.pop();
  return `Requires ${labels.length > 0 ? `${labels.join(', ')} and ${last}` : last}`;
}

/** Total effect of a stat research at a level: "+15%", "-9%", "+2". */
export function formatResearchEffect(effect: ResearchEffect, level: number): string {
  const value = effect.perLevel * level;
  if (effect.format === 'percent_less') return value > 0 ? `-${value}%` : '0%';
  return effect.format === 'percent' ? `+${value}%` : `+${value}`;
}
