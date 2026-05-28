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
  -- Low-lift additions to support the StoryBridge UI:
  title text,
  status text not null default 'submitted' -- draft | submitted | reviewed | in_advocacy
);

-- If the table already exists, add the new columns in place:
alter table public.stories add column if not exists title text;
alter table public.stories add column if not exists status text not null default 'submitted';

create index if not exists stories_created_at_idx on public.stories (created_at desc);
create index if not exists stories_category_idx on public.stories (category);
create index if not exists stories_status_idx on public.stories (status);

alter table public.stories enable row level security;

-- The prototype server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Add authenticated user policies before exposing Supabase directly to browsers.
