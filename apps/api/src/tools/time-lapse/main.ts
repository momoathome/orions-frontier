import { count, like } from 'drizzle-orm';
import { start } from '../../index.js';
import { getDb } from '../../lib/db/index.js';
import { users } from '../../lib/db/schema/users.js';
import { createRealtimeExecutionContext, gameNow } from '../../lib/game-execution-context.js';
import { logger } from '../../lib/logger.js';
import { findUserByEmail, updateUser } from '../../services/auth/index.js';
import { joinSyntheticPlayer, PlaytestPopulationRegistry } from '../playtest/population.js';
import { EVEN_PROFILE_WEIGHTS } from '../playtest/profile-distribution.js';

// The dev API on a fast game clock (`npm run time-lapse`): bots play while the map is open.
// Like the 72h baseline playtest, twelve synthetic players join, here spread over the 72 hours.
const PLAYERS = 12;
const JOIN_INTERVAL_MS = 6 * 3_600_000;
const DEV_PROTECTION_MS = 365 * 24 * 3_600_000;

const startedAt = Number(process.env['TIME_LAPSE_STARTED_AT']);
if (!process.env['TIME_LAPSE_SCALE'] || !startedAt) {
  // Synthetic players must never join the normal dev world.
  throw new Error('time-lapse needs TIME_LAPSE_SCALE and TIME_LAPSE_STARTED_AT');
}

await start();

// Bots respect attack protection; the default 24 h would end after minutes of the time-lapse.
const db = getDb();
const adminEmail = process.env['ADMIN_EMAIL']?.toLowerCase();
const admin = adminEmail ? await findUserByEmail(db, adminEmail) : undefined;
if (admin) {
  await db.transaction((tx) =>
    updateUser(tx, admin.id, {
      protectedUntil: new Date(gameNow().getTime() + DEV_PROTECTION_MS),
      attackProtectionBrokenAt: null,
    })
  );
}

let joining = false;
async function joinDuePlayers(): Promise<void> {
  const due = Math.min(
    PLAYERS,
    Math.floor((gameNow().getTime() - startedAt) / JOIN_INTERVAL_MS) + 1
  );
  // Counted in the database, so an API restart neither repeats nor skips a player.
  const [joined] = await db
    .select({ value: count() })
    .from(users)
    .where(like(users.username, 'playtest-player-%'));
  for (let playerIndex = joined?.value ?? 0; playerIndex < due; playerIndex += 1) {
    const { member } = await joinSyntheticPlayer(
      {
        playerIndex,
        profileWeights: EVEN_PROFILE_WEIGHTS,
        registry: new PlaytestPopulationRegistry(),
      },
      createRealtimeExecutionContext()
    );
    logger.info({ player: member.alias, profile: member.profile }, 'Time-lapse player joined');
  }
}

setInterval(() => {
  if (joining) return;
  joining = true;
  void joinDuePlayers()
    .catch((error: unknown) => {
      logger.error({ error }, 'Time-lapse join failed');
    })
    .finally(() => {
      joining = false;
    });
}, 5_000);
