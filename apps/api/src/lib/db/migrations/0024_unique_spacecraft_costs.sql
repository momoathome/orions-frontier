DELETE FROM "spacecraft_definition_costs" AS older
USING "spacecraft_definition_costs" AS newer
WHERE older."spacecraft_definition_id" = newer."spacecraft_definition_id"
  AND older."resource_key" = newer."resource_key"
  AND older.ctid < newer.ctid;

CREATE UNIQUE INDEX "spacecraft_definition_costs_definition_resource_unique"
  ON "spacecraft_definition_costs" ("spacecraft_definition_id", "resource_key");
