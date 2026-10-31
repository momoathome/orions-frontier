import type { SpacecraftRole } from '@orions-frontier/shared';

type RoleTheme = Record<'topBar' | 'badge' | 'badgeText' | 'statValue' | 'amount', string>;

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

/** `@error`-Handler für Bilder: blendet ein nicht ladbares Bild aus. */
export function hideBrokenImage(event: Event): void {
  if (event.target instanceof HTMLImageElement) event.target.style.display = 'none';
}
