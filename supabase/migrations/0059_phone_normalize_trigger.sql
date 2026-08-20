-- supabase/migrations/0059_phone_normalize_trigger.sql
-- Chantier de normalisation téléphone (docs/plan-normalisation-telephone.md,
-- décisions actées avec Pierre le 19/08/2026). 1er des 3 migrations, dans
-- cet ORDRE STRICT (trigger, puis données, puis CHECK) — voir 0060/0061.
-- Si le CHECK (0061) passait avant ce trigger, tout insert brut (notamment
-- le trigger handle_new_user, migration 0010, qui insère
-- raw_user_meta_data->>'phone' tel quel) échouerait immédiatement : les
-- inscriptions réelles casseraient. Ce trigger doit donc être en place et
-- vérifié AVANT que 0060/0061 ne soient exécutées.
--
-- normalize_phone() est un miroir exact de normalizePhone()
-- (src/lib/booking-utils.ts) — toute divergence future entre les deux doit
-- être traitée comme un bug. Ne normalise que le format (ajout du préfixe
-- +33 sur un numéro commençant par 0) ; ne valide PAS le format — la
-- validation reste la CHECK constraint (app_users_phone_format_check etc.,
-- migration 0056, resserrée en 0061) et isValidPhoneFormat() côté serveur.
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null then
    return null;
  end if;
  digits := regexp_replace(raw, '[^0-9+]', '', 'g');
  if digits like '+%' then
    return digits;
  elsif digits like '0%' then
    return '+33' || substring(digits from 2);
  elsif digits like '33%' then
    return '+' || digits;
  else
    return digits;
  end if;
end;
$$;

-- Une fonction trigger par table (colonne différente sur bookings :
-- client_phone, pas phone) — explicite plutôt que générique, même
-- convention que la migration 0056 (3 ALTER TABLE distincts).
create or replace function public.trg_normalize_app_users_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone := public.normalize_phone(new.phone);
  return new;
end;
$$;

create or replace function public.trg_normalize_booking_members_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone := public.normalize_phone(new.phone);
  return new;
end;
$$;

create or replace function public.trg_normalize_businesses_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone := public.normalize_phone(new.phone);
  return new;
end;
$$;

create or replace function public.trg_normalize_bookings_client_phone()
returns trigger
language plpgsql
as $$
begin
  new.client_phone := public.normalize_phone(new.client_phone);
  return new;
end;
$$;

drop trigger if exists app_users_normalize_phone on public.app_users;
create trigger app_users_normalize_phone
  before insert or update of phone on public.app_users
  for each row execute function public.trg_normalize_app_users_phone();

drop trigger if exists booking_members_normalize_phone on public.booking_members;
create trigger booking_members_normalize_phone
  before insert or update of phone on public.booking_members
  for each row execute function public.trg_normalize_booking_members_phone();

drop trigger if exists businesses_normalize_phone on public.businesses;
create trigger businesses_normalize_phone
  before insert or update of phone on public.businesses
  for each row execute function public.trg_normalize_businesses_phone();

drop trigger if exists bookings_normalize_client_phone on public.bookings;
create trigger bookings_normalize_client_phone
  before insert or update of client_phone on public.bookings
  for each row execute function public.trg_normalize_bookings_client_phone();

-- Vérification post-migration (lecture seule) : les 4 triggers doivent
-- apparaître, event_manipulation INSERT et UPDATE pour chacun.
select event_object_table, trigger_name, event_manipulation
from information_schema.triggers
where trigger_name like '%normalize%'
order by event_object_table, event_manipulation;
