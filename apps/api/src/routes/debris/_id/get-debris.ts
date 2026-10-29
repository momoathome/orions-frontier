import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../middleware/auth.js';
import { getDebrisById } from '../../../services/combat/index.js';
import { defineRoute, idParams } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate], schema: { params: idParams } }, async (request) => {
    const debris = await getDebrisById(request.params.id, request.user.userId);
    if (!debris) throw new AppError(ErrorCode.NOT_FOUND, 'Debris field not found');
    return debris;
  });
});
