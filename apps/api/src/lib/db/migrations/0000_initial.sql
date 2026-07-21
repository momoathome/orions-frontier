CREATE TYPE public.assignment_status AS ENUM (
    'traveling_to_asteroid',
    'traveling_to_station'
);
CREATE TYPE public.trip_endpoint_type AS ENUM (
    'station',
    'asteroid',
    'debris'
);
CREATE TYPE public.trip_purpose AS ENUM (
    'mine',
    'mining_return',
    'combat',
    'combat_return',
    'salvage',
    'salvage_return'
);
CREATE TYPE public.trip_status AS ENUM (
    'traveling',
    'arrived',
    'cancelled'
);
CREATE TABLE public.asteroid_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asteroid_id uuid NOT NULL,
    station_id uuid NOT NULL,
    assigned_amount integer DEFAULT 1 NOT NULL,
    assigned_at timestamp without time zone DEFAULT now() NOT NULL,
    status public.assignment_status DEFAULT 'traveling_to_asteroid'::public.assignment_status NOT NULL,
    recall_requested_at timestamp without time zone,
    recall_requested_amount integer DEFAULT 0 NOT NULL,
    spacecraft_key character varying(64) NOT NULL,
    CONSTRAINT asteroid_assignments_recall_requested_amount_valid CHECK (((recall_requested_amount >= 0) AND (recall_requested_amount <= assigned_amount)))
);
CREATE TABLE public.asteroid_veins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asteroid_id uuid NOT NULL,
    vein_type character varying(16) NOT NULL,
    resource_key character varying(64) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    remaining_amount integer DEFAULT 10000 NOT NULL,
    CONSTRAINT asteroid_veins_remaining_amount_non_negative CHECK ((remaining_amount >= 0))
);
CREATE TABLE public.asteroids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    chunk_x integer NOT NULL,
    chunk_y integer NOT NULL,
    hidden_level integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    size character varying(16) NOT NULL,
    sector_id uuid NOT NULL
);
CREATE TABLE public.bot_controllers (
    user_id uuid NOT NULL,
    strategy character varying(32) DEFAULT 'economic_v1'::character varying NOT NULL,
    next_decision_at timestamp without time zone DEFAULT now() NOT NULL,
    last_action character varying(64),
    last_reason character varying(255),
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.combat_missions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    attacker_station_id uuid NOT NULL,
    defender_station_id uuid NOT NULL,
    attacker_station_spacecraft_id uuid NOT NULL,
    outbound_trip_id uuid NOT NULL,
    return_trip_id uuid,
    attacker_amount integer NOT NULL,
    attacker_losses integer DEFAULT 0 NOT NULL,
    defender_losses integer DEFAULT 0 NOT NULL,
    winner character varying(16),
    loot jsonb,
    status character varying(16) DEFAULT 'traveling'::character varying NOT NULL,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.debris_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sector_id uuid NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    chunk_x integer NOT NULL,
    chunk_y integer NOT NULL,
    resources jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.salvage_missions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    station_id uuid NOT NULL,
    debris_field_id uuid,
    station_spacecraft_id uuid NOT NULL,
    outbound_trip_id uuid NOT NULL,
    return_trip_id uuid,
    amount integer NOT NULL,
    cargo jsonb,
    status character varying(16) DEFAULT 'traveling'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone
);
CREATE TABLE public.sectors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sector_x integer NOT NULL,
    sector_y integer NOT NULL,
    role character varying(16) NOT NULL,
    seed character varying(256) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.spacecraft_build_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_id uuid NOT NULL,
    amount integer NOT NULL,
    ends_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    spacecraft_key character varying(64) NOT NULL
);
CREATE TABLE public.spacecraft_trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_spacecraft_id uuid NOT NULL,
    group_size integer NOT NULL,
    from_type public.trip_endpoint_type NOT NULL,
    from_id uuid NOT NULL,
    to_type public.trip_endpoint_type NOT NULL,
    to_id uuid NOT NULL,
    departed_at timestamp without time zone NOT NULL,
    arrives_at timestamp without time zone NOT NULL,
    purpose public.trip_purpose NOT NULL,
    cargo_manifest jsonb,
    status public.trip_status DEFAULT 'traveling'::public.trip_status NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    assignment_id uuid
);
CREATE TABLE public.spawn_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_index integer NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    station_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    sector_id uuid NOT NULL,
    slot_type character varying(16) DEFAULT 'player'::character varying NOT NULL
);
CREATE TABLE public.station_buildings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_id uuid NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    upgrade_ends_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    building_key character varying(64) NOT NULL
);
CREATE TABLE public.station_influence (
    user_id uuid NOT NULL,
    station_id uuid NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.station_research (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_id uuid NOT NULL,
    technology_key character varying(64) NOT NULL,
    status character varying(16) DEFAULT 'researching'::character varying NOT NULL,
    completes_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone
);
CREATE TABLE public.station_resources (
    station_id uuid NOT NULL,
    resource_key character varying(64) NOT NULL,
    amount bigint DEFAULT 0 NOT NULL
);
CREATE TABLE public.station_spacecrafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    station_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    locked_amount integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    spacecraft_key character varying(64) NOT NULL
);
CREATE TABLE public.stations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(128) NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    sector_id uuid NOT NULL
);
CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(20) DEFAULT 'player'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.world_missions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    origin_station_id uuid NOT NULL,
    station_spacecraft_id uuid NOT NULL,
    mission_type character varying(16) NOT NULL,
    target_sector_x integer NOT NULL,
    target_sector_y integer NOT NULL,
    target_x double precision,
    target_y double precision,
    colony_name character varying(128),
    departed_at timestamp without time zone NOT NULL,
    arrives_at timestamp without time zone NOT NULL,
    status character varying(16) DEFAULT 'traveling'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    spacecraft_key character varying(64) NOT NULL
);
ALTER TABLE ONLY public.asteroid_assignments
    ADD CONSTRAINT asteroid_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.asteroid_veins
    ADD CONSTRAINT asteroid_veins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.asteroids
    ADD CONSTRAINT asteroids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bot_controllers
    ADD CONSTRAINT bot_controllers_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.debris_fields
    ADD CONSTRAINT debris_fields_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.spacecraft_build_orders
    ADD CONSTRAINT spacecraft_build_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.spacecraft_trips
    ADD CONSTRAINT spacecraft_trips_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.spawn_slots
    ADD CONSTRAINT spawn_slots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.station_buildings
    ADD CONSTRAINT station_buildings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.station_buildings
    ADD CONSTRAINT station_buildings_station_id_building_key_unique UNIQUE (station_id, building_key);
ALTER TABLE ONLY public.station_influence
    ADD CONSTRAINT station_influence_user_id_station_id_pk PRIMARY KEY (user_id, station_id);
ALTER TABLE ONLY public.station_research
    ADD CONSTRAINT station_research_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.station_research
    ADD CONSTRAINT station_research_station_technology_unique UNIQUE (station_id, technology_key);
ALTER TABLE ONLY public.station_resources
    ADD CONSTRAINT station_resources_pkey PRIMARY KEY (station_id, resource_key);
ALTER TABLE ONLY public.station_spacecrafts
    ADD CONSTRAINT station_spacecrafts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.station_spacecrafts
    ADD CONSTRAINT station_spacecrafts_station_id_spacecraft_key_unique UNIQUE (station_id, spacecraft_key);
ALTER TABLE ONLY public.stations
    ADD CONSTRAINT stations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);
ALTER TABLE ONLY public.world_missions
    ADD CONSTRAINT world_missions_pkey PRIMARY KEY (id);
CREATE INDEX asteroid_assignments_asteroid_id_idx ON public.asteroid_assignments USING btree (asteroid_id);
CREATE INDEX asteroid_assignments_asteroid_status_idx ON public.asteroid_assignments USING btree (asteroid_id, status);
CREATE INDEX asteroid_assignments_station_id_idx ON public.asteroid_assignments USING btree (station_id);
CREATE INDEX asteroid_assignments_station_status_idx ON public.asteroid_assignments USING btree (station_id, status);
CREATE INDEX asteroid_assignments_status_idx ON public.asteroid_assignments USING btree (status);
CREATE INDEX asteroid_veins_asteroid_id_idx ON public.asteroid_veins USING btree (asteroid_id);
CREATE INDEX asteroids_chunk_idx ON public.asteroids USING btree (chunk_x, chunk_y);
CREATE INDEX asteroids_chunk_x_idx ON public.asteroids USING btree (chunk_x);
CREATE INDEX asteroids_chunk_y_idx ON public.asteroids USING btree (chunk_y);
CREATE INDEX asteroids_sector_id_idx ON public.asteroids USING btree (sector_id) WHERE (sector_id IS NOT NULL);
CREATE INDEX bot_controllers_next_decision_at_idx ON public.bot_controllers USING btree (next_decision_at);
CREATE UNIQUE INDEX combat_missions_outbound_trip_unique ON public.combat_missions USING btree (outbound_trip_id);
CREATE UNIQUE INDEX combat_missions_return_trip_unique ON public.combat_missions USING btree (return_trip_id);
CREATE INDEX combat_missions_status_idx ON public.combat_missions USING btree (status);
CREATE INDEX combat_missions_user_id_idx ON public.combat_missions USING btree (user_id);
CREATE INDEX debris_fields_chunk_idx ON public.debris_fields USING btree (chunk_x, chunk_y);
CREATE INDEX debris_fields_sector_id_idx ON public.debris_fields USING btree (sector_id);
CREATE INDEX salvage_missions_debris_field_id_idx ON public.salvage_missions USING btree (debris_field_id);
CREATE INDEX salvage_missions_user_id_idx ON public.salvage_missions USING btree (user_id);
CREATE UNIQUE INDEX sectors_coords_unique ON public.sectors USING btree (sector_x, sector_y);
CREATE INDEX sectors_role_idx ON public.sectors USING btree (role);
CREATE INDEX spacecraft_build_orders_spacecraft_key_idx ON public.spacecraft_build_orders USING btree (spacecraft_key);
CREATE INDEX spacecraft_build_orders_station_id_idx ON public.spacecraft_build_orders USING btree (station_id);
CREATE INDEX spacecraft_trips_arrives_at_idx ON public.spacecraft_trips USING btree (arrives_at);
CREATE INDEX spacecraft_trips_assignment_id_idx ON public.spacecraft_trips USING btree (assignment_id);
CREATE INDEX spacecraft_trips_from_id_idx ON public.spacecraft_trips USING btree (from_id);
CREATE INDEX spacecraft_trips_outbound_idx ON public.spacecraft_trips USING btree (to_type, purpose, status, to_id);
CREATE INDEX spacecraft_trips_return_idx ON public.spacecraft_trips USING btree (from_type, purpose, status, from_id);
CREATE INDEX spacecraft_trips_station_spacecraft_id_idx ON public.spacecraft_trips USING btree (station_spacecraft_id);
CREATE INDEX spacecraft_trips_status_arrives_at_idx ON public.spacecraft_trips USING btree (status, arrives_at);
CREATE INDEX spacecraft_trips_status_idx ON public.spacecraft_trips USING btree (status);
CREATE INDEX spacecraft_trips_to_id_idx ON public.spacecraft_trips USING btree (to_id);
CREATE INDEX spawn_slots_sector_id_idx ON public.spawn_slots USING btree (sector_id) WHERE (sector_id IS NOT NULL);
CREATE UNIQUE INDEX spawn_slots_sector_slot_unique ON public.spawn_slots USING btree (sector_id, slot_index);
CREATE INDEX spawn_slots_station_id_idx ON public.spawn_slots USING btree (station_id);
CREATE UNIQUE INDEX spawn_slots_station_id_unique ON public.spawn_slots USING btree (station_id);
CREATE INDEX station_buildings_station_id_idx ON public.station_buildings USING btree (station_id);
CREATE INDEX station_influence_station_id_idx ON public.station_influence USING btree (station_id);
CREATE INDEX station_research_status_completes_at_idx ON public.station_research USING btree (status, completes_at);
CREATE INDEX station_resources_station_id_idx ON public.station_resources USING btree (station_id);
CREATE INDEX station_spacecrafts_station_id_idx ON public.station_spacecrafts USING btree (station_id);
CREATE INDEX stations_sector_id_idx ON public.stations USING btree (sector_id);
CREATE INDEX stations_user_id_idx ON public.stations USING btree (user_id);
CREATE INDEX world_missions_due_idx ON public.world_missions USING btree (status, arrives_at);
CREATE INDEX world_missions_user_id_idx ON public.world_missions USING btree (user_id);
ALTER TABLE ONLY public.asteroid_assignments
    ADD CONSTRAINT asteroid_assignments_asteroid_id_fkey FOREIGN KEY (asteroid_id) REFERENCES public.asteroids(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.asteroid_assignments
    ADD CONSTRAINT asteroid_assignments_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.asteroid_veins
    ADD CONSTRAINT asteroid_veins_asteroid_id_fkey FOREIGN KEY (asteroid_id) REFERENCES public.asteroids(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.asteroids
    ADD CONSTRAINT asteroids_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);
ALTER TABLE ONLY public.bot_controllers
    ADD CONSTRAINT bot_controllers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_attacker_station_id_fkey FOREIGN KEY (attacker_station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_attacker_station_spacecraft_id_fkey FOREIGN KEY (attacker_station_spacecraft_id) REFERENCES public.station_spacecrafts(id);
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_defender_station_id_fkey FOREIGN KEY (defender_station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_outbound_trip_id_fkey FOREIGN KEY (outbound_trip_id) REFERENCES public.spacecraft_trips(id);
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_return_trip_id_fkey FOREIGN KEY (return_trip_id) REFERENCES public.spacecraft_trips(id);
ALTER TABLE ONLY public.combat_missions
    ADD CONSTRAINT combat_missions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.debris_fields
    ADD CONSTRAINT debris_fields_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_debris_field_id_fkey FOREIGN KEY (debris_field_id) REFERENCES public.debris_fields(id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_outbound_trip_id_fkey FOREIGN KEY (outbound_trip_id) REFERENCES public.spacecraft_trips(id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_return_trip_id_fkey FOREIGN KEY (return_trip_id) REFERENCES public.spacecraft_trips(id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_station_spacecraft_id_fkey FOREIGN KEY (station_spacecraft_id) REFERENCES public.station_spacecrafts(id);
ALTER TABLE ONLY public.salvage_missions
    ADD CONSTRAINT salvage_missions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.spacecraft_build_orders
    ADD CONSTRAINT spacecraft_build_orders_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.spacecraft_trips
    ADD CONSTRAINT spacecraft_trips_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.asteroid_assignments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.spacecraft_trips
    ADD CONSTRAINT spacecraft_trips_station_spacecraft_id_fkey FOREIGN KEY (station_spacecraft_id) REFERENCES public.station_spacecrafts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.spawn_slots
    ADD CONSTRAINT spawn_slots_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);
ALTER TABLE ONLY public.spawn_slots
    ADD CONSTRAINT spawn_slots_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.station_buildings
    ADD CONSTRAINT station_buildings_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.station_influence
    ADD CONSTRAINT station_influence_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.station_influence
    ADD CONSTRAINT station_influence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.station_research
    ADD CONSTRAINT station_research_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.station_resources
    ADD CONSTRAINT station_resources_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.station_spacecrafts
    ADD CONSTRAINT station_spacecrafts_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.stations(id);
ALTER TABLE ONLY public.stations
    ADD CONSTRAINT stations_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);
ALTER TABLE ONLY public.stations
    ADD CONSTRAINT stations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.world_missions
    ADD CONSTRAINT world_missions_origin_station_id_fkey FOREIGN KEY (origin_station_id) REFERENCES public.stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.world_missions
    ADD CONSTRAINT world_missions_station_spacecraft_id_fkey FOREIGN KEY (station_spacecraft_id) REFERENCES public.station_spacecrafts(id);
ALTER TABLE ONLY public.world_missions
    ADD CONSTRAINT world_missions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
