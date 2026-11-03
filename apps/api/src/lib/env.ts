import type { FastifyServerOptions } from 'fastify';
import { z } from 'zod';

/** Placeholders from compose.yaml and .env.example; anyone can sign tokens with them. */
const DEV_JWT_SECRETS = new Set([
  'local-development-secret',
  'change-this-in-production-to-a-secure-random-string',
]);

/**
 * Fastify's trustProxy: "true"/"false", a hop count, or a comma list of proxy IPs/CIDRs. Off by
 * default: without a proxy, a client could fake its address via X-Forwarded-For.
 */
export const trustProxySchema = z
  .string()
  .trim()
  .optional()
  .transform((value): FastifyServerOptions['trustProxy'] => {
    if (!value || value === 'false') return false;
    if (value === 'true') return true;
    if (!/^\d+$/.test(value)) return value;
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(16),
    JWT_EXPIRES_IN: z.string().min(1).default('7d'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGIN: z.string().min(1).optional(),
    TRUST_PROXY: trustProxySchema,
    // Read by WORLD_CONFIG; validated here so production cannot start on the public default.
    WORLD_SEED: z.string().min(16).optional(),
    // Dev time-lapse, read by gameNow().
    TIME_LAPSE_SCALE: z.coerce.number().min(1).optional(),
    TIME_LAPSE_STARTED_AT: z.coerce.number().int().positive().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.CORS_ORIGIN !== undefined, {
    path: ['CORS_ORIGIN'],
    message: 'required in production, otherwise every origin may call the API',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.WORLD_SEED !== undefined, {
    path: ['WORLD_SEED'],
    message: 'required in production, otherwise anyone can compute the map from the public seed',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.TIME_LAPSE_SCALE === undefined, {
    path: ['TIME_LAPSE_SCALE'],
    message: 'not allowed in production, it moves every timestamp into the future',
  })
  .refine((env) => env.TIME_LAPSE_SCALE === undefined || env.TIME_LAPSE_STARTED_AT !== undefined, {
    path: ['TIME_LAPSE_STARTED_AT'],
    message: 'required with TIME_LAPSE_SCALE',
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.JWT_SECRET.length >= 32 && !DEV_JWT_SECRETS.has(env.JWT_SECRET)),
    { path: ['JWT_SECRET'], message: 'needs 32+ random characters in production, no placeholder' }
  );

export type Env = z.infer<typeof envSchema>;

/** Validates process.env once at startup so misconfiguration fails before any I/O. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
