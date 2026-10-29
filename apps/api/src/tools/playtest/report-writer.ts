import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PlaytestConfig } from './config.js';
import { playtestConfigHash, playtestReportSchema, type PlaytestReport } from './report-schema.js';

function rounded(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(6));
}

// eslint-disable-next-line no-restricted-syntax -- durchläuft beliebige JSON-Werte rekursiv.
function canonicalize(value: unknown): unknown {
  if (typeof value === 'number') return rounded(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function safeSeed(seed: string): string {
  return seed.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
}

export async function writePlaytestReport(
  config: PlaytestConfig,
  report: PlaytestReport
): Promise<string> {
  playtestReportSchema.parse(report);
  await mkdir(config.outputDirectory, { recursive: true });
  const filename = `${report.virtualStart.replace(/[:.]/g, '-')}-${safeSeed(
    config.seed
  )}-${playtestConfigHash(config)}.json`;
  const target = join(config.outputDirectory, filename);
  const temporary = `${target}.${process.pid}.tmp`;
  const content = `${JSON.stringify(canonicalize(report), null, 2)}\n`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
  return target;
}
