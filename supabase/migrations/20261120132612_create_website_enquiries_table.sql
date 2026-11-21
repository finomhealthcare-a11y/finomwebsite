create table public.website_enquiries (
  id bigint generated always as identity primary key,
  name text not null,
  company text,
  email text not null,
  phone text,
  enquiry_type text not null check (enquiry_type in ('product','distribution','collaboration','general')),
  message text not null,
  created_at timestamptz not null default now()
);
alter table public.website_enquiries enable row level security;
grant insert on public.website_enquiries to anon, authenticated;
create policy "Public can submit website enquiries"
on public.website_enquiries
for insert
to anon, authenticated
with check (
  length(trim(name)) between 1 and 120
  and length(trim(email)) between 3 and 254
  and length(trim(message)) between 1 and 5000
);
;
