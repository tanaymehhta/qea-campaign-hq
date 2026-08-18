alter table public.inbound_companies
  add column if not exists assigned_to text;

comment on column public.inbound_companies.assigned_to is
  'Rep who owns this account and signs its emails. Must match a key in copy_tables.SENDERS. NULL blocks drafting — there is no house sender.';
