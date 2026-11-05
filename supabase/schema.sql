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

-- ---------------------------------------------------------------------------------------------
-- Editable catalogue (admin panel): panels, brands, categories, boards, finishes, colour groups
-- and sheet sizes edited in /admin. Each row is one JSON document keyed by (kind, id):
--   kind 'product'  -> { "product": { ...full panel... } } or { "product": null } for a deleted panel
--   kind 'brand' | 'category' | 'board' | 'finish' | 'colourFamily' | 'size' -> a list entry
-- The brand files deployed with the site are never changed; these rows are applied on top.
create table if not exists public.catalogue_items (
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

-- Same rule as enquiries: RLS on, no policies, so only the server (service role key) can use it.
alter table public.catalogue_items enable row level security;

-- Public bucket for images uploaded in the admin (swatches, textures, brand logos).
-- Anyone can view the images (the studio needs them); only the server can upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogue-media', 'catalogue-media', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
