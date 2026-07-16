import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { requireStation } from '../../../middleware/require-station.js';
import { checkAndDispatchTransports } from '../../../services/transport/transport-dispatch.service.js';

/**
 * POST /api/stations/:stationId/dispatch-transport
 * Manually triggers the transport dispatch logic for this station.
 * Idle transporters will be sent to asteroids that have enough buffer.
 * Used by the player to immediately trigger pickups without waiting for the cron.
 */
export default defineRoute(async (app) => {
  app.post(
    '/dispatch-transport',
    { preHandler: [authenticate, requireStation] },
    async (request, reply) => {
      const { stationId } = request.params as { stationId: string };

      const dispatched = await checkAndDispatchTransports(stationId);

      return reply.send({
        success: true,
        data: { dispatched },
        message:
          dispatched > 0
            ? `${dispatched} transporter(s) dispatched`
            : 'No transporters dispatched (no idle transporters or no pickups needed)',
      });
    }
  );
});
