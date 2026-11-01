import { describe, expect, test } from 'vitest';
import {
  formatAgo,
  formatAmount,
  formatBlockers,
  formatBuildTime,
  formatCountdown,
  formatDuration,
} from '../../src/shared/lib/format';

describe('time formats', () => {
  test('countdown shows hours only when needed and stops at zero', () => {
    expect(formatCountdown(252_000, 0)).toBe('4:12');
    expect(formatCountdown(3_852_000, 0)).toBe('1:04:12');
    expect(formatCountdown(0, 5_000)).toBe('0:00');
  });

  test('build time rounds seconds and drops zero parts', () => {
    expect(formatBuildTime(44.6)).toBe('45s');
    expect(formatBuildTime(725)).toBe('12m 5s');
    expect(formatBuildTime(720)).toBe('12m');
    expect(formatBuildTime(5_400)).toBe('1h 30m');
  });

  test('durations switch units and show a dash without a value', () => {
    expect(formatDuration(0.01)).toBe('1 min');
    expect(formatDuration(3.5)).toBe('3.5 h');
    expect(formatDuration(50)).toBe('2.1 d');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  test('relative time counts down to minutes, hours and days', () => {
    const now = 10 * 24 * 3_600_000;
    expect(formatAgo(now - 30_000, now)).toBe('just now');
    expect(formatAgo(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAgo(now - 3 * 24 * 3_600_000, now)).toBe('3 d ago');
  });
});

test('amounts are compact in tight rows', () => {
  expect(formatAmount(950.7)).toBe('950');
  expect(formatAmount(4_210)).toBe('4.2k');
  expect(formatAmount(42_600)).toBe('43k');
  expect(formatAmount(1_300_000)).toBe('1.3M');
});

test('requirement blockers read like the server errors', () => {
  expect(
    formatBlockers([
      { type: 'lab_cap', level: 3, current: 2 },
      { type: 'building', key: 'shipyard', level: 2, current: 1 },
    ])
  ).toBe('Requires Laboratory 3 and Shipyard 2');
  expect(formatBlockers([{ type: 'maxed' }])).toBe('Max level reached');
});
