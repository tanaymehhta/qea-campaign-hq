# The migrations directory, and what it is now guaranteed to be

**The standard, from `PLAN.md` Phase 6: a fresh database built from this directory alone
must match production.** As of 18 August 2026 it does. This file records how that was
established, because the gap it closed was twelve times larger than anyone thought.

## What was wrong

`TRUST.md` recorded two holes: `proposals` had no migration, and `20260817211639` was
referenced by a later file that did not exist. Both true. But comparing the directory
against `supabase_migrations.schema_migrations` — the database's own record of what it
actually ran — found the real shape of it:

- **24 applied migrations had no file of that name here at all.** Not two. Among them
  `add_proposals`, `reply_identity_trigger`, seven inbound stage-3 migrations, the manual
  queue overrides, and `v_inbound_stranded`.
- **The two sides used different numbering schemes.** Files here carried hand-written
  round numbers (`20260730120000`); the database recorded real applied timestamps
  (`20260730132126`). 19 files were the same migration under a different name, which is
  why a version-by-version comparison looked catastrophic and a name-by-name one did not.

A rebuild from this directory would have produced a database missing a table the dashboard
reads on every page load.

## What was done

Every migration's full SQL — comments included — is stored in
`supabase_migrations.schema_migrations.statements`. The directory was rebuilt from it:

1. **61 files written straight from the database to disk**, byte for byte, routed through
   a throwaway view rather than retyped, because a transcription slip inside a function
   body would not surface until someone tried to restore.
2. **`schedule_sync` was excluded from that export and left as it was.** It is the one
   migration whose recorded SQL contains a live Vault token; the copy here is redacted to
   `<SUPABASE_ANON_KEY>` and must stay that way.
3. **Seven files kept their local prose.** Their statements matched what was applied
   exactly, but the applied record had lost the comments — someone had run the statements
   rather than the file. `group_mark_dolan_roof` was 4,134 bytes here against 1,401 in the
   database, all of it reasoning. The larger version won.
4. **20 duplicate round-numbered files were removed.** Every one was verified equivalent
   on statements first, ignoring comments and whitespace. Git holds them.

Two needed a decision rather than a rule:

- **`conflicts_and_human_classification`** was applied here as one migration and recorded
  as three (`…235357`, `…235806 fill_reply_identities`, `…235834 reply_identity_trigger`).
  The split covers it; the combined local file was removed.
- **`feedback`** differed for real: the applied version uses em dashes in two `raise
  exception` messages where the local file had `--`. The applied version is what runs, so
  it won.

## What it is now

**63 files. 62 of them map one-to-one onto the database's recorded history.**

The 63rd is `20260728180000_inbound_schema.sql`, and it is the one honest remaining
irregularity. The database has no record of it ever being applied, yet all eleven tables
it defines exist in production — they were created outside the migration system by the
sibling `qea-inbound` repository. It is kept because it is the only definition of those
tables anywhere here, and a rebuild without it would come up missing the entire inbound
half. Its own header says all this. It is safe to re-apply: every `create` is
`if not exists`, and enabling row level security twice is a no-op.

Every one of the fourteen `inbound_*` tables in production now has a `create` statement
somewhere in this directory — checked, not assumed.

## Keeping it true

Schema change → migration → git → production, with no production-only DDL. The check that
this still holds is a comparison, not a habit:

```sql
-- every applied migration should have a file named <version>_<name>.sql
select version, name from supabase_migrations.schema_migrations order by version;
```

```bash
# and every file should be an applied migration — bar the one named above
ls supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort -u
```
