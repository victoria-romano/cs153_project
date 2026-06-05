-- Storybook schema. All data in this prototype is non-PHI and illustrative.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  doctor_name text not null,
  specialty text,
  encounter_date date,
  reference_code text,
  transcript text not null,
  summary text,
  category text,
  title text,
  -- draft | submitted | reviewed | in_advocacy | shared_with_policymakers
  status text not null default 'submitted'
);

-- If the table already exists, add the new columns in place:
alter table public.stories add column if not exists title text;
alter table public.stories add column if not exists status text not null default 'submitted';

create index if not exists stories_created_at_idx on public.stories (created_at desc);
create index if not exists stories_category_idx on public.stories (category);
create index if not exists stories_status_idx on public.stories (status);

alter table public.stories enable row level security;

-- Living policy briefs: one row per theme/category, re-synthesized on demand
-- from all submitted stories in that theme.
create table if not exists public.policy_briefs (
  theme text primary key,
  brief text not null,
  story_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists policy_briefs_updated_at_idx
  on public.policy_briefs (updated_at desc);

alter table public.policy_briefs enable row level security;

-- IMPORTANT:
-- The prototype server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Anonymous submissions are stored with doctor_name = 'Anonymous clinician'.
-- The "Provider name" identity on the clinician dashboard is a localStorage
-- string only — there is NO authentication yet. Per-provider visibility
-- (clinician sees only their own; OCHE sees all) requires a real auth system
-- (Supabase Auth or equivalent) plus RLS policies, before exposing Supabase
-- directly to browsers.
