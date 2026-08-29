-- =============================================================================
-- 0016 — What the public pages are allowed to ask for
-- =============================================================================
-- The portals read tables directly and let RLS decide. Two things they cannot
-- do that way: apply the block rule to private slots, and count a camp's
-- occupancy without reading rows they are not allowed to see. Both are
-- functions, so both live here.
-- =============================================================================

-- Every private slot a parent may be offered, across all trainers. The
-- per-trainer version in 0006 is what the trainer's own screens use; this is
-- the one behind the public booking page, and it applies the same rule: a slot
-- is only offered if it joins existing work, or if it is a seed slot we are
-- willing to open knowing a second booking can make it viable.
create or replace function offerable_private_slots_all(
  p_from date default current_date,
  p_to   date default null
)
returns table (
  slot_id uuid,
  trainer_id uuid,
  trainer_name text,
  location_id uuid,
  location_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  price_cents integer,
  joins_existing_work boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ps.id, ps.trainer_id, t.display_name, ps.location_id, l.name,
    ps.starts_at, ps.ends_at,
    case when ps.price_cents > 0 then ps.price_cents
         else round(setting_int('private_hourly_price_cents', 10000)
                    * extract(epoch from (ps.ends_at - ps.starts_at)) / 3600.0)::integer
    end,
    slot_adjoins_work(ps.trainer_id, ps.starts_at, ps.ends_at, ps.location_id)
  from private_slots ps
  join trainers t on t.id = ps.trainer_id and t.status = 'active'
  left join locations l on l.id = ps.location_id
  where ps.status = 'available'
    and ps.starts_at >= now() + make_interval(hours => setting_int('min_notice_hours', 12))
    and ps.starts_at::date between p_from
        and coalesce(p_to, p_from + setting_int('booking_horizon_days', 45))
    and (
      slot_adjoins_work(ps.trainer_id, ps.starts_at, ps.ends_at, ps.location_id)
      or setting_bool('allow_seed_private_slots', true)
    )
  order by ps.starts_at;
$$;

comment on function offerable_private_slots_all is
  'The public private-training board. Applies the block rule, so a slot that would send a trainer across town for one isolated hour is never shown.';

-- Anonymous visitors need the occupancy of a camp to see how full it is, and
-- of a group to see how close it is to running. Both functions are already
-- security definer and count rather than return rows, so no family is exposed
-- by either — but the grant has to be explicit.
grant execute on function camp_occupancy(uuid) to anon, authenticated;
grant execute on function group_occupancy(uuid) to anon, authenticated;
grant execute on function camps_near(text, numeric, text, text, smallint, camp_day_option, date, date)
  to anon, authenticated;
grant execute on function offerable_private_slots_all(date, date) to anon, authenticated;
grant execute on function player_is_eligible(uuid, uuid) to authenticated;

-- Deliberately not granted to anon: anything that reads or writes a family's
-- own data. Those all go through an authenticated call or an edge function.
revoke execute on function begin_checkout(text, uuid, uuid, text) from anon;
revoke execute on function begin_camp_registration(uuid, uuid, camp_day_option, text, uuid[], jsonb)
  from anon;
