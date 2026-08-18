-- ---------- email_account_daily : per-mailbox send volume ----------
-- Instantly's account-scoped daily analytics endpoint reports sent (and a few
-- other counters) per mailbox per day. lemlist has no equivalent endpoint for
-- campaign-send volume per mailbox (only warmup-pool volume, a different
-- number), so this table is Instantly-only for now.
create table email_account_daily (
  email        text not null,
  source       text not null default 'instantly',
  metric_date  date not null,
  sent         int default 0,
  bounced      int default 0,
  replied      int default 0,
  pulled_at    timestamptz not null default now(),
  primary key (source, email, metric_date)
);
create index on email_account_daily (email);
create index on email_account_daily (metric_date);

alter table email_account_daily enable row level security;
create policy "public read" on public.email_account_daily
  for select to anon, authenticated using (true);
