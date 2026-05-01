-- RoboBuilder — Supabase initialization
--
-- Run this ONCE in your Supabase project's SQL editor (Project → SQL Editor → New query → Run).
-- It creates a single `saves` table where each authenticated user has exactly one row,
-- and turns on Row-Level Security so every user can only read and write their own row.
--
-- Re-running the script is safe: every statement is guarded by IF NOT EXISTS or
-- DROP-then-CREATE for the policies.

create table if not exists public.saves (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  build       jsonb not null default '{}'::jsonb,
  code        text  not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.saves enable row level security;

-- Drop pre-existing policies before recreating, so re-running is idempotent.
drop policy if exists "saves_select_own" on public.saves;
drop policy if exists "saves_insert_own" on public.saves;
drop policy if exists "saves_update_own" on public.saves;

create policy "saves_select_own" on public.saves
  for select using (auth.uid() = user_id);

create policy "saves_insert_own" on public.saves
  for insert with check (auth.uid() = user_id);

create policy "saves_update_own" on public.saves
  for update using (auth.uid() = user_id);
