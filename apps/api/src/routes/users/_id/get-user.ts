import { defineRoute } from '../../../lib/route-helper.js';

/**
 * Get single user by ID (Example route)
 * GET /api/users/:id
 * 
 * Note: The folder name _id becomes the URL parameter :id
 */
export default defineRoute(async (app) => {
  app.get('/', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    // TODO: Implement actual user fetching from database
    return reply.send({
      user: {
        id,
        username: `user-${id}`,
        createdAt: new Date().toISOString(),
      },
    });
  });
});
