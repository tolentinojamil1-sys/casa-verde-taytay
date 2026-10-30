-- Casa Verde Taytay booking schema. Run once in Supabase SQL Editor.
-- Booking requests are pending; only an authorised admin can confirm/cancel.
create extension if not exists pgcrypto;
create table if not exists public.cv_admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table if not exists public.cv_bookings (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 check_in date not null, check_out date not null,
 guests int not null check (guests between 1 and 10),
 guest_name text not null, email text not null, phone text not null,
 payment_method text not null check (payment_method in ('gcash','bdo')),
 status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
 source text not null default 'website',
 notes text not null default '',
 check (check_out > check_in),
 check (char_length(guest_name) between 2 and 120),
 check (char_length(email) between 5 and 254),
 check (char_length(phone) between 7 and 40)
);
create table if not exists public.cv_blocks (
 id uuid primary key default gen_random_uuid(),
 check_in date not null, check_out date not null,
 reason text not null default '',
 created_at timestamptz not null default now(),
 check(check_out > check_in)
);
create index if not exists cv_bookings_dates on public.cv_bookings(check_in,check_out);
create index if not exists cv_blocks_dates on public.cv_blocks(check_in,check_out);
alter table public.cv_admins enable row level security;
alter table public.cv_bookings enable row level security;
alter table public.cv_blocks enable row level security;
revoke all on public.cv_admins,public.cv_bookings,public.cv_blocks from anon,authenticated;
create or replace function public.cv_is_admin() returns boolean language sql security definer set search_path = '' stable as $$
 select exists(select 1 from public.cv_admins where user_id=auth.uid())
$$;
revoke all on function public.cv_is_admin() from public;
grant execute on function public.cv_is_admin() to authenticated;

-- Public calendar returns occupied date ranges only, never personal data.
create or replace function public.cv_public_calendar(p_from date,p_to date)
returns table(check_in date,check_out date,kind text)
language plpgsql security definer set search_path = '' as $$
begin
 if p_from is null or p_to is null or p_to <= p_from or p_to > p_from + 370 then
  raise exception 'Invalid date range';
 end if;
 return query select b.check_in,b.check_out,'booking'::text
   from public.cv_bookings b where b.status in ('pending','confirmed') and b.check_in<p_to and b.check_out>p_from
 union all select x.check_in,x.check_out,'blocked'::text from public.cv_blocks x
   where x.check_in<p_to and x.check_out>p_from;
end $$;
revoke all on function public.cv_public_calendar(date,date) from public;
grant execute on function public.cv_public_calendar(date,date) to anon,authenticated;

-- Serialize write operations so concurrent guests cannot request overlapping dates.
-- A single property means advisory-lock contention is minimal.
create or replace function public.cv_request_booking(
 p_in date,p_out date,p_guests integer,p_name text,p_email text,p_phone text,p_payment text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
 perform pg_advisory_xact_lock(76100423);
 if p_in is null or p_out is null or p_in < current_date or p_out <= p_in or p_out > p_in + 30 then
  raise exception 'Select valid future dates (maximum 30 nights)';
 end if;
 if p_guests is null or p_guests not between 1 and 10 or
   char_length(trim(coalesce(p_name,''))) not between 2 and 120 or
   char_length(trim(coalesce(p_email,''))) not between 5 and 254 or
   char_length(trim(coalesce(p_phone,''))) not between 7 and 40 or
   p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or
   p_payment not in ('gcash','bdo') then
   raise exception 'Invalid booking details';
 end if;
 if exists(select 1 from public.cv_bookings where status in ('pending','confirmed') and check_in<p_out and check_out>p_in)
  or exists(select 1 from public.cv_blocks where check_in<p_out and check_out>p_in)
 then raise exception 'Selected dates are unavailable'; end if;
 insert into public.cv_bookings(check_in,check_out,guests,guest_name,email,phone,payment_method)
 values(p_in,p_out,p_guests,trim(p_name),trim(p_email),trim(p_phone),p_payment) returning id into new_id;
 return new_id;
end $$;
revoke all on function public.cv_request_booking(date,date,integer,text,text,text,text) from public;
grant execute on function public.cv_request_booking(date,date,integer,text,text,text,text) to anon,authenticated;

create or replace function public.cv_admin_list()
returns table(id uuid,created_at timestamptz,check_in date,check_out date,guests int,guest_name text,email text,phone text,payment_method text,status text,source text,notes text)
language plpgsql security definer set search_path = '' as $$
begin
 if not public.cv_is_admin() then raise exception 'Unauthorized'; end if;
 return query select b.id,b.created_at,b.check_in,b.check_out,b.guests,b.guest_name,b.email,b.phone,b.payment_method,b.status,b.source,b.notes from public.cv_bookings b order by b.created_at desc limit 500;
end $$;
revoke all on function public.cv_admin_list() from public;
grant execute on function public.cv_admin_list() to authenticated;

create or replace function public.cv_admin_status(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.cv_bookings%rowtype;
begin
 if not public.cv_is_admin() then raise exception 'Unauthorized'; end if;
 if p_status not in ('pending','confirmed','cancelled') then raise exception 'Invalid status'; end if;
 perform pg_advisory_xact_lock(76100423);
 select * into b from public.cv_bookings where id=p_id for update;
 if not found then raise exception 'Booking not found'; end if;
 if p_status in ('pending','confirmed') and b.status='cancelled' and
 (exists(select 1 from public.cv_bookings x where x.id<>p_id and x.status in ('pending','confirmed') and x.check_in<b.check_out and x.check_out>b.check_in)
 or exists(select 1 from public.cv_blocks x where x.check_in<b.check_out and x.check_out>b.check_in)) then
 raise exception 'Dates already occupied'; end if;
 update public.cv_bookings set status=p_status where id=p_id;
end $$;
revoke all on function public.cv_admin_status(uuid,text) from public;
grant execute on function public.cv_admin_status(uuid,text) to authenticated;

create or replace function public.cv_admin_block(p_in date,p_out date,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if not public.cv_is_admin() then raise exception 'Unauthorized'; end if;
 if p_in is null or p_out is null or p_out<=p_in then raise exception 'Invalid dates'; end if;
 perform pg_advisory_xact_lock(76100423);
 if exists(select 1 from public.cv_bookings where status in ('pending','confirmed') and check_in<p_out and check_out>p_in)
 or exists(select 1 from public.cv_blocks where check_in<p_out and check_out>p_in) then raise exception 'Dates already occupied'; end if;
 insert into public.cv_blocks(check_in,check_out,reason) values(p_in,p_out,left(coalesce(p_reason,''),200)) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.cv_admin_block(date,date,text) from public;
grant execute on function public.cv_admin_block(date,date,text) to authenticated;

create or replace function public.cv_admin_blocks() returns table(id uuid,check_in date,check_out date,reason text)
language plpgsql security definer set search_path = '' as $$
begin
 if not public.cv_is_admin() then raise exception 'Unauthorized'; end if;
 return query select b.id,b.check_in,b.check_out,b.reason from public.cv_blocks b order by b.check_in;
end $$;
revoke all on function public.cv_admin_blocks() from public;
grant execute on function public.cv_admin_blocks() to authenticated;

create or replace function public.cv_admin_unblock(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.cv_is_admin() then raise exception 'Unauthorized'; end if;
 delete from public.cv_blocks where id=p_id;
end $$;
revoke all on function public.cv_admin_unblock(uuid) from public;
grant execute on function public.cv_admin_unblock(uuid) to authenticated;

-- Once you have created a user in Supabase Authentication, run:
-- insert into public.cv_admins(user_id)
-- select id from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com';
-- NEVER put an admin password or service_role key in GitHub.
