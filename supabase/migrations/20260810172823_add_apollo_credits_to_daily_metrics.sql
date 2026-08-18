alter table inbound_daily_metrics
  add column if not exists apollo_credits integer not null default 0;

comment on column inbound_daily_metrics.apollo_credits is
  'Apollo reveal credits spent on this date (America/New_York). Written by apollo.py''s daily cap gate; the cap reads this back so it survives GitHub Actions restarts.';
