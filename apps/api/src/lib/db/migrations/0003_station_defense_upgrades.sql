INSERT INTO public.station_buildings (station_id, building_key, level, created_at, updated_at)
SELECT stations.id, defense_buildings.building_key, 0, now(), now()
FROM public.stations
CROSS JOIN (
  VALUES
    ('armor_plating'),
    ('guardian_cannon'),
    ('defense_drones'),
    ('minefield')
) AS defense_buildings(building_key)
ON CONFLICT (station_id, building_key) DO NOTHING;
