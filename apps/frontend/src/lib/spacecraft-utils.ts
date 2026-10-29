import type { SpacecraftRole } from '@orions-frontier/shared';

export interface RoleTheme {
  topBar: string;
  badge: string;
  badgeText: string;
  statValue: string;
  amount: string;
}

export const roleThemes: Record<SpacecraftRole, RoleTheme> = {
  fighter: {
    topBar: 'bg-rose-500',
    badge: 'bg-rose-500/15 border-rose-500/30',
    badgeText: 'text-rose-300',
    statValue: 'text-rose-200',
    amount: 'text-rose-300',
  },
  bomber: {
    topBar: 'bg-orange-600',
    badge: 'bg-orange-600/15 border-orange-600/30',
    badgeText: 'text-orange-300',
    statValue: 'text-orange-200',
    amount: 'text-orange-300',
  },
  miner: {
    topBar: 'bg-amber-500',
    badge: 'bg-amber-500/15 border-amber-500/30',
    badgeText: 'text-amber-300',
    statValue: 'text-amber-200',
    amount: 'text-amber-300',
  },
  salvager: {
    topBar: 'bg-violet-500',
    badge: 'bg-violet-500/15 border-violet-500/30',
    badgeText: 'text-violet-300',
    statValue: 'text-violet-200',
    amount: 'text-violet-300',
  },
};

export function roleTheme(role: SpacecraftRole): RoleTheme {
  return roleThemes[role];
}

export function formatBuildTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export interface BuildOrder {
  id: string;
  amount: number;
  endsAt: string;
  spacecraftName: string;
  spacecraftRole: SpacecraftRole;
}

/** `@error`-Handler für Bilder: blendet ein nicht ladbares Bild aus. */
export function hideBrokenImage(event: Event): void {
  if (event.target instanceof HTMLImageElement) event.target.style.display = 'none';
}
