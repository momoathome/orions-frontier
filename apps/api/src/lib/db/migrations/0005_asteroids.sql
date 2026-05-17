CREATE TABLE IF NOT EXISTS "asteroid_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"center_x" double precision NOT NULL,
	"center_y" double precision NOT NULL,
	"radius" double precision NOT NULL,
	"resource_bias" varchar(64) NOT NULL,
	"seed" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asteroids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"chunk_x" integer NOT NULL,
	"chunk_y" integer NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"richness" integer NOT NULL,
  "stability" integer NOT NULL,
	"hidden_level" integer DEFAULT 0 NOT NULL,
	"cluster_id" uuid,
	"is_depleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asteroids_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "asteroid_clusters"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroids_chunk_idx" ON "asteroids" ("chunk_x", "chunk_y");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroids_chunk_x_idx" ON "asteroids" ("chunk_x");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroids_chunk_y_idx" ON "asteroids" ("chunk_y");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asteroids_cluster_id_idx" ON "asteroids" ("cluster_id");
