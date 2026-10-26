import { authenticate } from '../../../middleware/auth.js';
import { getAsteroidById } from '../../../services/asteroid.service.js';
import { defineRoute, idParams, scannerBypassQuery } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { params: idParams, querystring: scannerBypassQuery } },
    async (request, reply) => {
      const scannerBypass = request.user.role === 'admin' && request.query.scannerBypass === 'true';
      const asteroid = await getAsteroidById(request.params.id, request.user.userId, scannerBypass);

      if (!asteroid) {
        return reply.status(404).send({ message: 'Asteroid not found' });
      }

      return asteroid;
    }
  );
});
