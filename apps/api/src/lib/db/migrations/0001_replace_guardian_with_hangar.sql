UPDATE public.station_buildings
SET building_key = 'hangar', updated_at = now()
WHERE building_key = 'guardian';
