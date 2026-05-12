import { defineRoute } from '../../lib/route-helper.js';

/**
 * List all users (Example route)
 * GET /api/users
 */
export default defineRoute(async (app) => {
  app.get('/', async (_request, reply) => {
    // TODO: Implement actual user fetching from database
    return reply.send({
      users: [
        { id: '1', username: 'example' },
        { id: '2', username: 'demo' },
      ],
    });
  });
});
