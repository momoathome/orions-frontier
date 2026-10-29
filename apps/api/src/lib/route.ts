import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Routen-Plugin mit Zod-Type-Provider: `params`, `querystring` und `body` kommen typisiert an. */
export const defineRoute = (plugin: FastifyPluginAsyncZod) => plugin;

export const stationParams = z.object({ stationId: z.uuid() });
export const idParams = z.object({ id: z.uuid() });

/** Nur Admins dürfen den Scanner umgehen; die Route prüft die Rolle. */
export const scannerBypassQuery = z.object({ scannerBypass: z.string().optional() });

export const chunkRangeQuery = scannerBypassQuery.extend({
  minChunkX: z.string().optional(),
  maxChunkX: z.string().optional(),
  minChunkY: z.string().optional(),
  maxChunkY: z.string().optional(),
});

/** Login und Registrierung pro IP: bremst Credential Stuffing und teure bcrypt-Runden. */
export const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };
