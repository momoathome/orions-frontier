import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Helper function to define file-based routes with proper TypeScript inference.
 * This is a pure type wrapper that enables better IDE support and type checking.
 * 
 * @example
 * export default defineRoute(async (app) => {
 *   app.get('/', async (request, reply) => {
 *     return { hello: 'world' };
 *   });
 * });
 */
export const defineRoute = (plugin: FastifyPluginAsync): FastifyPluginAsync => {
  return fp(plugin);
};
