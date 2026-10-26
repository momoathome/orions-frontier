import { resources } from '@orions-frontier/game-config';
import { isOneOf, resourceKeys } from '@orions-frontier/shared';

const RESOURCE_COLORS: Record<string, string> = {
  carbon: '#778899',
  titanium: '#6699bb',
  hydrogenium: '#22ccee',
  kyber_crystal: '#aa33ff',
  astatine: '#ff5533',
};

export function resourceColor(key: string | null): string {
  return key ? (RESOURCE_COLORS[key] ?? '#888888') : '#888888';
}

export function resourceName(key: string): string {
  return isOneOf(resourceKeys, key) ? resources[key].name : key.toUpperCase();
}
