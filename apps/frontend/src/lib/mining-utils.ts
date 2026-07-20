export const RESOURCE_COLORS: Record<string, string> = {
  carbon: '#778899',
  titanium: '#6699bb',
  hydrogenium: '#22ccee',
  kyber_crystal: '#aa33ff',
  astatine: '#ff5533',
};

export const RESOURCE_NAMES: Record<string, string> = {
  carbon: 'Carbon',
  titanium: 'Titanium',
  hydrogenium: 'Hydrogenium',
  kyber_crystal: 'Kyber Crystal',
  astatine: 'Astatine',
};
export function resourceColor(key: string | null): string {
  return key ? (RESOURCE_COLORS[key] ?? '#888888') : '#888888';
}

export function resourceName(key: string): string {
  return RESOURCE_NAMES[key] ?? key.toUpperCase();
}
