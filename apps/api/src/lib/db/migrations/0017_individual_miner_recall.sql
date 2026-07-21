ALTER TABLE "asteroid_assignments"
ADD COLUMN "recall_requested_amount" integer NOT NULL DEFAULT 0;

UPDATE "asteroid_assignments"
SET "recall_requested_amount" = "assigned_amount"
WHERE "recall_requested_at" IS NOT NULL;

ALTER TABLE "asteroid_assignments"
ADD CONSTRAINT "asteroid_assignments_recall_requested_amount_valid"
CHECK (
  "recall_requested_amount" >= 0
  AND "recall_requested_amount" <= "assigned_amount"
);
