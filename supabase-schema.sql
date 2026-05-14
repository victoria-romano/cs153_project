create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  doctor_name text not null,
  specialty text,
  encounter_date date,
  reference_code text,
  transcript text not null,
  summary text,
  category text
);

create index if not exists stories_created_at_idx on public.stories (created_at desc);
create index if not exists stories_category_idx on public.stories (category);

alter table public.stories enable row level security;

-- The prototype server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Add authenticated user policies before exposing Supabase directly to browsers.
