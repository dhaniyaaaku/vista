-- Vista schema.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> Run).
--
-- The security model is entirely row-level. The browser holds a publishable key that anyone can
-- read out of the bundle, so nothing may rely on the client behaving. Instead every table has RLS
-- enabled and every policy matches only rows where user_id = auth.uid(). Reading someone else's
-- city is not "prevented by a check we remembered to write" — it is structurally impossible,
-- because the database will not return the rows.
--
-- Note that enabling RLS with no policies denies everything. The policies below are the only way
-- any row is ever visible.

-- ---------------------------------------------------------------- entries --

create table if not exists public.entries (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        date not null,
  text        text not null check (char_length(text) between 1 and 300),
  category    text not null check (
                category in ('personal','rest','connection','creative','learning','milestone')
              ),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists entries_user_date_idx on public.entries (user_id, date);

-- ------------------------------------------------------------ commitments --

create table if not exists public.commitments (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  cadence_times integer not null check (cadence_times between 1 and 50),
  cadence_per   text not null check (cadence_per in ('day','week','month')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists commitments_user_idx on public.commitments (user_id);

-- ------------------------------------------------------- commitment logs --

create table if not exists public.commitment_logs (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  commitment_id uuid not null references public.commitments (id) on delete cascade,
  date          date not null,
  created_at    timestamptz not null default now(),
  -- One completion per commitment per day. A floor is a day you did the thing, not a tally of
  -- how many times you pressed the button.
  unique (commitment_id, date)
);

create index if not exists commitment_logs_user_idx on public.commitment_logs (user_id, date);

-- -------------------------------------------------------------------- RLS --

alter table public.entries         enable row level security;
alter table public.commitments     enable row level security;
alter table public.commitment_logs enable row level security;

-- Policies are written per-command rather than as one "for all", so that the insert path can
-- also assert the incoming user_id rather than only filtering what is read back.

drop policy if exists entries_select on public.entries;
drop policy if exists entries_insert on public.entries;
drop policy if exists entries_update on public.entries;
drop policy if exists entries_delete on public.entries;

create policy entries_select on public.entries
  for select using (auth.uid() = user_id);
create policy entries_insert on public.entries
  for insert with check (auth.uid() = user_id);
create policy entries_update on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy entries_delete on public.entries
  for delete using (auth.uid() = user_id);

drop policy if exists commitments_select on public.commitments;
drop policy if exists commitments_insert on public.commitments;
drop policy if exists commitments_update on public.commitments;
drop policy if exists commitments_delete on public.commitments;

create policy commitments_select on public.commitments
  for select using (auth.uid() = user_id);
create policy commitments_insert on public.commitments
  for insert with check (auth.uid() = user_id);
create policy commitments_update on public.commitments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy commitments_delete on public.commitments
  for delete using (auth.uid() = user_id);

drop policy if exists commitment_logs_select on public.commitment_logs;
drop policy if exists commitment_logs_insert on public.commitment_logs;
drop policy if exists commitment_logs_delete on public.commitment_logs;

create policy commitment_logs_select on public.commitment_logs
  for select using (auth.uid() = user_id);
create policy commitment_logs_insert on public.commitment_logs
  for insert with check (auth.uid() = user_id);
create policy commitment_logs_delete on public.commitment_logs
  for delete using (auth.uid() = user_id);
