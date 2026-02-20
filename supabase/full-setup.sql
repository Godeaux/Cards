-- Cards MVP Supabase schema (guest-only, no auth)
-- Paste into Supabase SQL Editor and run.

create extension if not exists pgcrypto;

create table if not exists public.lobby_players (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  username text not null,
  seat_no int,
  stack int not null default 100,
  joined_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

create table if not exists public.table_settings (
  id int primary key default 1,
  small_blind int not null default 1,
  big_blind int not null default 2,
  turn_seconds int not null default 60,
  updated_at timestamptz not null default now()
);

create table if not exists public.game_state (
  id int primary key default 1,
  hand_no int not null default 0,
  phase text not null default 'waiting',
  dealer_seat int,
  current_turn_session_id text,
  pot int not null default 0,
  showdown_state jsonb not null default '{}'::jsonb,
  hand_state jsonb not null default '{}'::jsonb,
  last_action_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Safe migration for existing DBs
alter table public.game_state
  add column if not exists showdown_state jsonb not null default '{}'::jsonb;

alter table public.game_state
  add column if not exists hand_state jsonb not null default '{}'::jsonb;

create table if not exists public.hand_actions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_session_id text,
  actor_username text,
  action text not null,
  payload jsonb not null default '{}'::jsonb
);

insert into public.table_settings (id, small_blind, big_blind, turn_seconds)
values (1, 1, 2, 60)
on conflict (id) do nothing;

insert into public.game_state (id, hand_no, phase, pot, showdown_state)
values (1, 0, 'waiting', 0, '{}'::jsonb)
on conflict (id) do nothing;

-- MVP simplicity: disable RLS for anon key usage
alter table public.lobby_players disable row level security;
alter table public.table_settings disable row level security;
alter table public.game_state disable row level security;
alter table public.hand_actions disable row level security;

-- Optional cleanup helper
create or replace function public.cleanup_stale_lobby_players()
returns void
language sql
as $$
  delete from public.lobby_players
  where heartbeat_at < now() - interval '5 minutes';
$$;
