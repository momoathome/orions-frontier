-- Replace the last generator-specific sector name and reset pre-sector bot identities.
TRUNCATE TABLE "sectors" CASCADE;
DELETE FROM "users" WHERE "role" = 'bot';

DROP INDEX "sectors_archetype_id_idx";
ALTER TABLE "sectors" RENAME COLUMN "archetype_id" TO "role";
ALTER TABLE "sectors" ALTER COLUMN "role" TYPE varchar(16);
CREATE INDEX "sectors_role_idx" ON "sectors" ("role");
