import type { BuildingEffectType, CostShortfall } from '@orions-frontier/shared';
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

/** Build duration in the largest fitting unit: "45s", "12m", "1.5h". */
export function formatBuildTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3_600).toFixed(1)}h`;
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
    case 'station_progression':
      return { label: 'Progression', display: `+${value}` };
    case 'hangar_capacity':
      return { label: 'Crew places', display: `${value}` };
    case 'spacecraft_unlock':
      return { label: 'Spacecraft', display: `Tier ${value}` };
    case 'spacecraft_production_bonus':
      return { label: 'Build Speed', display: `+${value}%` };
    case 'storage_capacity':
      return { label: 'Capacity', display: value.toLocaleString('en-US') };
    case 'protected_storage':
      return { label: 'Protected', display: value.toLocaleString('en-US') };
    case 'scanner_range':
      return { label: 'Scan Range', display: `${value.toLocaleString('en-US')} units` };
    case 'research_capacity':
      return { label: 'Research capacity', display: `${value}` };
  }
}
