import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Routen-Plugin mit Zod-Type-Provider: `params`, `querystring` und `body` kommen typisiert an. */
export const defineRoute = (plugin: FastifyPluginAsyncZod) => plugin;

export const stationParams = z.object({ stationId: z.uuid() });
export const idParams = z.object({ id: z.uuid() });

/** Schiffsanzahl: begrenzt auf int4, weil sie mit Integer-Spalten verglichen wird (sonst 500 statt 400). */
export const shipAmount = z.number().int().min(1).max(2_147_483_647);
export const shipAmountQuery = z.coerce.number().int().min(1).max(2_147_483_647);

/** Nur Admins dürfen den Scanner umgehen; die Route prüft die Rolle. */
export const scannerBypassQuery = z.object({ scannerBypass: z.string().optional() });

export const chunkRangeQuery = scannerBypassQuery.extend({
  minChunkX: z.string().optional(),
  maxChunkX: z.string().optional(),
  minChunkY: z.string().optional(),
  maxChunkY: z.string().optional(),
});

/** Eine Seite einer Liste, neueste zuerst; `offset` überspringt die schon geladenen Einträge. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Login und Registrierung pro IP: bremst Credential Stuffing und teure bcrypt-Runden. */
export const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };
