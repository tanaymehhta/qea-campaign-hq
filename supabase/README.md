# Supabase side

Project `yfnqszwlyoyfhuwfmcyl` (region us-east-2).

## Migrations

`migrations/` is exported from the project's own `supabase_migrations.schema_migrations`
table, so it is the exact SQL that was applied, in order:

1. `core_schema` — twelve tables. Field names follow the QEA Vault's vocabulary
   rather than inventing new ones.
2. `views_and_rls` — four reporting views, RLS enabled everywhere with a
   select-only policy for `anon`.
3. `schedule_sync` — `pg_cron` + `pg_net`, the three schedules, and
   `trigger_sync()` which reads its bearer token from Vault.
4. `derive_lemlist_totals` — recomputes lemlist lifetime figures from the
   activity stream, because lemlist's own `/stats` endpoint is window-sensitive.

## Secrets

`INSTANTLY_API_KEY`, `LEMLIST_API_KEY` and `SYNC_INVOKE_TOKEN` live in Supabase
Vault. They are read by `public.get_secret(text)`, a `security definer` function
with execute granted to `service_role` only. Nothing in this repository contains
a write credential.

## Schedules

| Job | Cron (UTC) | Window | Also does |
|---|---|---|---|
| `qea-sync-30min` | `*/30 * * * *` | today + yesterday | — |
| `qea-sync-nightly` | `0 7 * * *` | last 14 days | sequence copy, step metrics, mailboxes |
| `qea-sync-weekly` | `0 8 * * 0` | last 90 days | everything above |

Nightly and weekly are 03:00 and 04:00 America/New_York.
