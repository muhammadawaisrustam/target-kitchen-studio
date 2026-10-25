-- Optional: store quotation enquiries in Supabase (free tier) instead of a server file.
-- Run this once in the Supabase SQL editor, then set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
-- in the server's environment (never in NEXT_PUBLIC_ variables or browser code).

create table if not exists public.enquiries (
  id uuid primary key,
  reference text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  status text not null check (status in ('new', 'contacted', 'quoted', 'closed')),
  data jsonb not null
);

create index if not exists enquiries_created_at_idx on public.enquiries (created_at desc);

-- Row Level Security on, with no policies: the public (anon) key can neither read nor write.
-- Only the server, using the service role key, can access the table.
alter table public.enquiries enable row level security;

-- Optional: private storage for preview images that customers choose to attach to a quote from
-- "My Kitchen Photo". The bucket is PRIVATE (public = false): images are only read by the server
-- with the service role key and shown to signed-in admins. Never make this bucket public.
insert into storage.buckets (id, name, public)
values ('enquiry-previews', 'enquiry-previews', false)
on conflict (id) do update set public = false;
