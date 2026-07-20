ALTER TABLE "asteroids" DROP COLUMN IF EXISTS "cluster_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "asteroid_clusters";
--> statement-breakpoint
ALTER TABLE "sectors" DROP COLUMN IF EXISTS "gameplay_tags";
