-- These two shipped without RLS while every sibling inbound_* table has it on with a
-- select-only policy. inbound_emails holds addresses and full message bodies, so the
-- gap mattered. Match the existing pattern: reads for the dashboard, writes only via
-- the service role.
alter table public.inbound_emails enable row level security;
alter table public.inbound_intent_signals enable row level security;

drop policy if exists inbound_emails_read on public.inbound_emails;
create policy inbound_emails_read on public.inbound_emails
  for select to anon, authenticated using (true);

drop policy if exists inbound_intent_signals_read on public.inbound_intent_signals;
create policy inbound_intent_signals_read on public.inbound_intent_signals
  for select to anon, authenticated using (true);
