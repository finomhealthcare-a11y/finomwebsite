-- Idempotent email delivery log for INSERT webhooks on public.website_enquiries.
-- Production audit confirmed public.website_enquiries.id is BIGINT.
-- This table stores delivery metadata only; it does not copy enquiry content.

create table if not exists public.website_enquiry_notification_deliveries (
  enquiry_id bigint primary key,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed')),
  resend_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists website_enquiry_notification_deliveries_status_idx
  on public.website_enquiry_notification_deliveries (delivery_status);

alter table public.website_enquiry_notification_deliveries enable row level security;

comment on table public.website_enquiry_notification_deliveries is
  'Tracks outbound Resend notifications for website enquiries (dedup / retry).';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'website_enquiries'
      and column_name = 'id'
      and data_type = 'bigint'
  ) and not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'website_enquiry_notification_deliveries'
      and constraint_name = 'website_enquiry_notification_deliveries_enquiry_id_fkey'
  ) then
    alter table public.website_enquiry_notification_deliveries
      add constraint website_enquiry_notification_deliveries_enquiry_id_fkey
      foreign key (enquiry_id)
      references public.website_enquiries (id)
      on delete cascade;
  else
    raise exception 'Expected public.website_enquiries.id BIGINT; refusing incompatible foreign key';
  end if;
end $$;
