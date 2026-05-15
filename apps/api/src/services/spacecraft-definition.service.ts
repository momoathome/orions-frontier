import { getDb } from '../lib/db/index.js';
import { spacecraftDefinitions, spacecraftDefinitionCosts } from '../lib/db/schema/spacecraft-definitions.js';
import { spacecrafts } from '@orions-frontier/game-config';

// ============================================================================
// Seed spacecraft definitions (idempotent)
// ============================================================================

export const seedSpacecraftDefinitions = async (): Promise<void> => {
  const db = getDb();

  for (const def of spacecrafts) {
    const [inserted] = await db
      .insert(spacecraftDefinitions)
      .values({
        key: def.key,
        name: def.name,
        description: def.description,
        role: def.role,
        image: def.image,
        attack: def.attack,
        defense: def.defense,
        cargo: def.cargo,
        speed: def.speed,
        miningRate: def.miningRate,
        buildTime: def.buildTime,
      })
      .onConflictDoNothing({ target: spacecraftDefinitions.key })
      .returning({ id: spacecraftDefinitions.id, key: spacecraftDefinitions.key });

    if (!inserted) {
      // Already seeded – skip costs
      continue;
    }

    if (def.costs.length > 0) {
      await db.insert(spacecraftDefinitionCosts).values(
        def.costs.map((cost) => ({
          spacecraftDefinitionId: inserted.id,
          resourceKey: cost.resourceKey,
          amount: cost.amount,
        })),
      );
    }
  }
};
