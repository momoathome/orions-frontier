ALTER TABLE public.stations
    ADD COLUMN chunk_x integer DEFAULT 0 NOT NULL,
    ADD COLUMN chunk_y integer DEFAULT 0 NOT NULL;

UPDATE public.stations
SET chunk_x = floor(x::numeric / 1000)::integer,
    chunk_y = floor(y::numeric / 1000)::integer;

CREATE INDEX stations_chunk_idx ON public.stations USING btree (chunk_x, chunk_y);

ALTER TABLE public.spacecraft_trips
    ADD COLUMN from_x double precision DEFAULT 0 NOT NULL,
    ADD COLUMN from_y double precision DEFAULT 0 NOT NULL,
    ADD COLUMN to_x double precision DEFAULT 0 NOT NULL,
    ADD COLUMN to_y double precision DEFAULT 0 NOT NULL;

UPDATE public.spacecraft_trips trip
SET from_x = COALESCE(
        CASE trip.from_type
            WHEN 'station' THEN (SELECT station.x FROM public.stations station WHERE station.id = trip.from_id)
            WHEN 'asteroid' THEN (SELECT asteroid.x FROM public.asteroids asteroid WHERE asteroid.id = trip.from_id)
            WHEN 'debris' THEN (SELECT debris.x FROM public.debris_fields debris WHERE debris.id = trip.from_id)
        END,
        0
    ),
    from_y = COALESCE(
        CASE trip.from_type
            WHEN 'station' THEN (SELECT station.y FROM public.stations station WHERE station.id = trip.from_id)
            WHEN 'asteroid' THEN (SELECT asteroid.y FROM public.asteroids asteroid WHERE asteroid.id = trip.from_id)
            WHEN 'debris' THEN (SELECT debris.y FROM public.debris_fields debris WHERE debris.id = trip.from_id)
        END,
        0
    ),
    to_x = COALESCE(
        CASE trip.to_type
            WHEN 'station' THEN (SELECT station.x FROM public.stations station WHERE station.id = trip.to_id)
            WHEN 'asteroid' THEN (SELECT asteroid.x FROM public.asteroids asteroid WHERE asteroid.id = trip.to_id)
            WHEN 'debris' THEN (SELECT debris.x FROM public.debris_fields debris WHERE debris.id = trip.to_id)
        END,
        0
    ),
    to_y = COALESCE(
        CASE trip.to_type
            WHEN 'station' THEN (SELECT station.y FROM public.stations station WHERE station.id = trip.to_id)
            WHEN 'asteroid' THEN (SELECT asteroid.y FROM public.asteroids asteroid WHERE asteroid.id = trip.to_id)
            WHEN 'debris' THEN (SELECT debris.y FROM public.debris_fields debris WHERE debris.id = trip.to_id)
        END,
        0
    );

CREATE INDEX spacecraft_trips_active_arrives_at_idx
    ON public.spacecraft_trips USING btree (arrives_at)
    WHERE status = 'traveling';

ALTER TABLE public.asteroids DROP COLUMN hidden_level;
