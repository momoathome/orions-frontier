import postgres from 'postgres';

const STATIC_TARGET_MS = 50;
const TRIPS_TARGET_MS = 100;

interface ExplainNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: ExplainNode[];
}

interface ExplainDocument {
  Plan: ExplainNode;
  'Planning Time': number;
  'Execution Time': number;
}

interface ExplainRow {
  'QUERY PLAN': ExplainDocument[];
}

const planDocument = (rows: ExplainRow[]): ExplainDocument => {
  const document = rows[0]?.['QUERY PLAN'][0];
  if (!document) throw new Error('PostgreSQL returned no query plan');
  return document;
};

const sequentialScans = (node: ExplainNode): string[] => [
  ...(node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : []),
  ...(node.Plans?.flatMap(sequentialScans) ?? []),
];

const result = (document: ExplainDocument, forbiddenSequentialScans: string[]) => {
  const scans = sequentialScans(document.Plan);
  return {
    executionMs: document['Execution Time'],
    planningMs: document['Planning Time'],
    sequentialScans: scans,
    indexedCandidates: !scans.some((table) => forbiddenSequentialScans.includes(table)),
  };
};

const run = async () => {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not defined');

  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql`create temporary table visibility_asteroids (like asteroids including all)`;
    await sql`create temporary table visibility_asteroid_veins (like asteroid_veins including all)`;
    await sql`create temporary table visibility_debris (like debris_fields including all)`;
    await sql`create temporary table visibility_stations (like stations including all)`;
    await sql`create temporary table visibility_spacecrafts (like station_spacecrafts including all)`;
    await sql`create temporary table visibility_trips (like spacecraft_trips including all)`;

    await sql`
      insert into visibility_asteroids (id, x, y, chunk_x, chunk_y, size, sector_id)
      select
        md5('visibility-asteroid-' || n::text)::uuid,
        (((n - 1) % 1000) - 500) * 1000 + 100,
        (((n - 1) / 1000) - 50) * 1000 + 100,
        ((n - 1) % 1000) - 500,
        ((n - 1) / 1000) - 50,
        'small',
        '00000000-0000-0000-0000-000000000001'::uuid
      from generate_series(1, 100000) n
    `;
    await sql`
      insert into visibility_asteroid_veins
        (id, asteroid_id, vein_type, resource_key, remaining_amount)
      select
        md5('visibility-vein-' || n::text)::uuid,
        md5('visibility-asteroid-' || n::text)::uuid,
        'primary',
        'carbon',
        1000
      from generate_series(1, 100000) n
    `;
    await sql`
      insert into visibility_debris (id, sector_id, x, y, chunk_x, chunk_y, resources)
      select
        md5('visibility-debris-' || n::text)::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        (((n - 1) % 100) - 50) * 1000 + 100,
        (((n - 1) / 100) - 50) * 1000 + 100,
        ((n - 1) % 100) - 50,
        ((n - 1) / 100) - 50,
        '{"carbon":10}'::jsonb
      from generate_series(1, 10000) n
    `;
    await sql`
      insert into visibility_stations (id, user_id, name, sector_id, x, y, chunk_x, chunk_y)
      select
        md5('visibility-station-' || n::text)::uuid,
        '00000000-0000-0000-0000-000000000002'::uuid,
        'Benchmark ' || n::text,
        '00000000-0000-0000-0000-000000000001'::uuid,
        (((n - 1) % 100) - 50) * 1000 + 100,
        (((n - 1) / 100) - 25) * 1000 + 100,
        ((n - 1) % 100) - 50,
        ((n - 1) / 100) - 25
      from generate_series(1, 5000) n
    `;
    await sql`
      insert into visibility_spacecrafts
        (id, station_id, spacecraft_key, amount, locked_amount)
      values (
        '00000000-0000-0000-0000-000000000003'::uuid,
        md5('visibility-station-1')::uuid,
        'mole',
        10000,
        10000
      )
    `;
    await sql`
      insert into visibility_trips
        (id, station_spacecraft_id, group_size, from_type, from_id, from_x, from_y,
         to_type, to_id, to_x, to_y, departed_at, arrives_at, purpose, status)
      select
        md5('visibility-trip-' || n::text)::uuid,
        '00000000-0000-0000-0000-000000000003'::uuid,
        1,
        'station',
        md5('visibility-station-1')::uuid,
        -5000,
        0,
        'station',
        md5('visibility-station-2')::uuid,
        5000,
        0,
        now() - interval '1 hour',
        now() + (n - 100) * interval '1 second',
        'combat',
        'traveling'
      from generate_series(1, 10000) n
    `;

    await sql`analyze visibility_asteroids`;
    await sql`analyze visibility_asteroid_veins`;
    await sql`analyze visibility_debris`;
    await sql`analyze visibility_stations`;
    await sql`analyze visibility_spacecrafts`;
    await sql`analyze visibility_trips`;

    const asteroidPlan = planDocument(
      await sql<ExplainRow[]>`
        explain (analyze, buffers, format json)
        select asteroid.id, asteroid.x, asteroid.y, asteroid.chunk_x, asteroid.chunk_y,
               asteroid.size, vein.resource_key
        from visibility_asteroids asteroid
        left join visibility_asteroid_veins vein
          on vein.asteroid_id = asteroid.id and vein.vein_type = 'primary'
        where asteroid.chunk_x between -2 and 2 and asteroid.chunk_y between -2 and 2
      `
    );
    const debrisPlan = planDocument(
      await sql<ExplainRow[]>`
        explain (analyze, buffers, format json)
        select id, x, y, chunk_x, chunk_y, resources
        from visibility_debris
        where chunk_x between -2 and 2 and chunk_y between -2 and 2
      `
    );
    const stationPlan = planDocument(
      await sql<ExplainRow[]>`
        explain (analyze, buffers, format json)
        select id, user_id, name, x, y
        from visibility_stations
        where chunk_x between -2 and 2 and chunk_y between -2 and 2
      `
    );
    const tripPlan = planDocument(
      await sql<ExplainRow[]>`
        explain (analyze, buffers, format json)
        select trip.id, trip.from_x, trip.from_y, trip.to_x, trip.to_y,
               trip.departed_at, trip.arrives_at, trip.purpose, trip.group_size,
               spacecraft.spacecraft_key, station.user_id
        from visibility_trips trip
        inner join visibility_spacecrafts spacecraft on spacecraft.id = trip.station_spacecraft_id
        inner join visibility_stations station on station.id = spacecraft.station_id
        where trip.status = 'traveling'
      `
    );
    const settlementPlan = planDocument(
      await sql<ExplainRow[]>`
        explain (analyze, buffers, format json)
        select id
        from visibility_trips
        where status = 'traveling' and arrives_at <= now()
        order by arrives_at
      `
    );

    const report = {
      dataset: { asteroids: 100_000, debris: 10_000, stations: 5_000, activeTrips: 10_000 },
      targetsMs: { staticProjection: STATIC_TARGET_MS, tripProjection: TRIPS_TARGET_MS },
      plans: {
        asteroids: result(asteroidPlan, ['visibility_asteroids']),
        debris: result(debrisPlan, ['visibility_debris']),
        stations: result(stationPlan, ['visibility_stations']),
        trips: result(tripPlan, []),
        dueTripSettlement: result(settlementPlan, ['visibility_trips']),
      },
    };
    const staticExecutionMs = Math.max(
      report.plans.asteroids.executionMs,
      report.plans.debris.executionMs,
      report.plans.stations.executionMs
    );
    const passed =
      report.plans.asteroids.indexedCandidates &&
      report.plans.debris.indexedCandidates &&
      report.plans.stations.indexedCandidates &&
      report.plans.dueTripSettlement.indexedCandidates &&
      staticExecutionMs < STATIC_TARGET_MS &&
      report.plans.trips.executionMs < TRIPS_TARGET_MS;

    console.log(JSON.stringify({ ...report, passed }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await sql.end();
  }
};

await run();
