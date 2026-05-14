import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '@orions-frontier/shared';

export type { JwtPayload };

// Augment @fastify/jwt so request.user is typed everywhere
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

// ============================================================================
// Plugin
// ============================================================================

const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.register(fastifyJwt, {
    secret: process.env['JWT_SECRET'] as string,
    sign: {
      expiresIn: (process.env['JWT_EXPIRES_IN'] as string) ?? '7d',
    },
  });
};

export default fp(jwtPlugin, {
  name: 'jwt',
  fastify: '4.x',
});
