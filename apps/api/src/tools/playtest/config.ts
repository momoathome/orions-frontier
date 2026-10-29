import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { isKeyOf } from '@orions-frontier/shared';
import { EVEN_PROFILE_WEIGHTS, type BotProfileWeights } from './profile-distribution.js';

export const MAX_PLAYTEST_DURATION_HOURS = 365 * 24;
export const MAX_PLAYTEST_SYNTHETIC_PLAYERS = 10_000;
export const MAX_PLAYTEST_TICKS = 31_536_000;

const finitePositive = z.number().positive();
const profileWeightsSchema = z
  .object({
    industrialist: z.number().nonnegative(),
    pioneer: z.number().nonnegative(),
    technocrat: z.number().nonnegative(),
    warlord: z.number().nonnegative(),
  })
  .refine((weights) => Object.values(weights).some((weight) => weight > 0), {
    message: 'At least one profile weight must be positive',
  });

const softlockThresholdSchema = z
  .object({
    blockedGoalHours: finitePositive.default(6),
    noProgressHours: finitePositive.default(6),
    unstableColonyHours: finitePositive.default(6),
    repeatedActionCount: z.number().int().min(2).max(1_000).default(5),
    goalSwitchesPerHour: z.number().int().min(1).max(1_000).default(6),
    capacityBottleneckHours: finitePositive.default(6),
    coreMilestoneHours: finitePositive.default(24),
  })
  .default({
    blockedGoalHours: 6,
    noProgressHours: 6,
    unstableColonyHours: 6,
    repeatedActionCount: 5,
    goalSwitchesPerHour: 6,
    capacityBottleneckHours: 6,
    coreMilestoneHours: 24,
  });

const playtestConfigSchema = z
  .object({
    seed: z.string().trim().min(1).max(256).default('playtest-standard'),
    virtualStart: z
      .string()
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
          Number.isFinite(new Date(value).getTime()),
        'Must be an ISO timestamp'
      )
      .default('2030-01-01T00:00:00.000Z'),
    durationHours: finitePositive.max(MAX_PLAYTEST_DURATION_HOURS).default(24),
    stepSeconds: finitePositive.min(1).max(60).default(60),
    joinIntervalMinutes: finitePositive.default(15),
    populationLimit: z.number().int().min(1).max(MAX_PLAYTEST_SYNTHETIC_PLAYERS).default(12),
    profileWeights: profileWeightsSchema.default(EVEN_PROFILE_WEIGHTS),
    snapshotIntervalMinutes: finitePositive.default(15),
    outputDirectory: z.string().trim().min(1).default('artifacts/playtests'),
    diagnosticWindowSize: z.number().int().min(1).max(10_000).default(2_000),
    softlockThresholds: softlockThresholdSchema,
  })
  .strict()
  .superRefine((config, context) => {
    const ticks = Math.ceil((config.durationHours * 3_600) / config.stepSeconds) + 1;
    if (ticks > MAX_PLAYTEST_TICKS) {
      context.addIssue({
        code: 'custom',
        path: ['stepSeconds'],
        message: `Configuration would exceed ${MAX_PLAYTEST_TICKS} ticks`,
      });
    }
  });

export interface PlaytestConfig {
  seed: string;
  virtualStart: Date;
  durationMs: number;
  stepMs: number;
  joinIntervalMs: number;
  populationLimit: number;
  profileWeights: BotProfileWeights;
  snapshotIntervalMs: number;
  outputDirectory: string;
  diagnosticWindowSize: number;
  softlockThresholds: SoftlockThresholds;
}

export interface SoftlockThresholds {
  blockedGoalMs: number;
  noProgressMs: number;
  unstableColonyMs: number;
  repeatedActionCount: number;
  goalSwitchesPerHour: number;
  capacityBottleneckMs: number;
  coreMilestoneMs: number;
}

type RawPlaytestConfig = z.input<typeof playtestConfigSchema>;
/** Datei- und CLI-Werte vor dem Zusammenführen; `validatePlaytestConfig` prüft das Ergebnis. */
type PlaytestOverrides = Omit<RawPlaytestConfig, 'profileWeights'> & {
  profileWeights?: Partial<BotProfileWeights>;
};

const CLI_FIELDS = {
  '--seed': 'seed',
  '--start': 'virtualStart',
  '--duration-hours': 'durationHours',
  '--step-seconds': 'stepSeconds',
  '--join-interval-minutes': 'joinIntervalMinutes',
  '--population-limit': 'populationLimit',
  '--snapshot-interval-minutes': 'snapshotIntervalMinutes',
  '--output-directory': 'outputDirectory',
  '--diagnostic-window-size': 'diagnosticWindowSize',
} as const;

const PROFILE_FLAGS = {
  '--profile-industrialist': 'industrialist',
  '--profile-pioneer': 'pioneer',
  '--profile-technocrat': 'technocrat',
  '--profile-warlord': 'warlord',
} as const;

function numericCliValue(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires a finite number`);
  return parsed;
}

function valueAfter(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${args[index]} requires a value`);
  return value;
}

async function configFile(args: readonly string[]): Promise<PlaytestOverrides> {
  const index = args.indexOf('--config');
  if (index < 0) return {};
  const path = resolve(valueAfter(args, index));
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read playtest config ${path}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Playtest config file must contain a JSON object');
  }
  return parsed;
}

function cliOverrides(args: readonly string[]): PlaytestOverrides {
  const overrides: PlaytestOverrides = {};
  const profileWeights: Partial<BotProfileWeights> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === undefined) break;
    if (flag === '--config') {
      index += 1;
      continue;
    }
    if (isKeyOf(CLI_FIELDS, flag)) {
      const value = valueAfter(args, index);
      const field = CLI_FIELDS[flag];
      if (field === 'seed' || field === 'virtualStart' || field === 'outputDirectory') {
        overrides[field] = value;
      } else {
        overrides[field] = numericCliValue(flag, value);
      }
      index += 1;
      continue;
    }
    if (isKeyOf(PROFILE_FLAGS, flag)) {
      const value = valueAfter(args, index);
      const profile = PROFILE_FLAGS[flag];
      profileWeights[profile] = numericCliValue(flag, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown playtest option: ${flag}`);
  }
  if (Object.keys(profileWeights).length > 0) overrides.profileWeights = profileWeights;
  return overrides;
}

export function validatePlaytestConfig(input: RawPlaytestConfig): PlaytestConfig {
  const raw = playtestConfigSchema.parse(input);
  return {
    seed: raw.seed,
    virtualStart: new Date(raw.virtualStart),
    durationMs: raw.durationHours * 3_600_000,
    stepMs: raw.stepSeconds * 1_000,
    joinIntervalMs: raw.joinIntervalMinutes * 60_000,
    populationLimit: raw.populationLimit,
    profileWeights: raw.profileWeights,
    snapshotIntervalMs: raw.snapshotIntervalMinutes * 60_000,
    outputDirectory: resolve(raw.outputDirectory),
    diagnosticWindowSize: raw.diagnosticWindowSize,
    softlockThresholds: {
      blockedGoalMs: raw.softlockThresholds.blockedGoalHours * 3_600_000,
      noProgressMs: raw.softlockThresholds.noProgressHours * 3_600_000,
      unstableColonyMs: raw.softlockThresholds.unstableColonyHours * 3_600_000,
      repeatedActionCount: raw.softlockThresholds.repeatedActionCount,
      goalSwitchesPerHour: raw.softlockThresholds.goalSwitchesPerHour,
      capacityBottleneckMs: raw.softlockThresholds.capacityBottleneckHours * 3_600_000,
      coreMilestoneMs: raw.softlockThresholds.coreMilestoneHours * 3_600_000,
    },
  };
}

export async function loadPlaytestConfig(args: readonly string[]): Promise<PlaytestConfig> {
  const fromFile = await configFile(args);
  const fromCli = cliOverrides(args);
  const fileWeights = fromFile.profileWeights ?? {};
  const cliWeights = fromCli.profileWeights ?? {};
  const fileThresholds = fromFile.softlockThresholds ?? {};
  const cliThresholds = fromCli.softlockThresholds ?? {};
  return validatePlaytestConfig({
    ...fromFile,
    ...fromCli,
    profileWeights: {
      ...EVEN_PROFILE_WEIGHTS,
      ...fileWeights,
      ...cliWeights,
    },
    softlockThresholds: {
      ...fileThresholds,
      ...cliThresholds,
    },
  });
}
