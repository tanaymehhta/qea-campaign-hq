-- Manual overrides for the inbound queue.
--
-- These live in their own columns rather than on `priority` / `sendable`, which
-- supabase_io.ROUTING_COLS patches on every stage-2 re-run: a hand-set priority
-- would be silently undone within three hours. Nothing in the pipeline writes
-- these two, so a human decision outlives the next run.

alter table inbound_people
  add column if not exists manual_rank integer,
  add column if not exists manual_sendable boolean;

comment on column inbound_people.manual_rank is
  'Hand-set queue order within a company. NULL = use the pipeline''s priority. Never written by the pipeline.';
comment on column inbound_people.manual_sendable is
  'Hand-set override of `sendable`. NULL = defer to the classifier. Never written by the pipeline.';

-- New columns are appended, never inserted: create-or-replace cannot rename or
-- reorder an existing view column, and the leading list is what every reader
-- already selects by name.
create or replace view inbound_people_view as
 SELECT p.id, p.company_id, p.first_name, p.last_name, p.full_name, p.title,
    p.linkedin_url, p.email, p.phone, p.city, p.state, p.source,
    p.role_hypothesis, p.priority, p.include_reason, p.outreach_status,
    p.last_touched_at, p.raw, p.created_at, p.updated_at, p.role_bucket,
    p.fit_tier, p.list_status, p.email_status, p.email_source, p.seniority_band,
    p.company_match, p.title_cluster, p.sendable, p.sendable_reason, p.apollo_id,
    c.name AS company_name,
    c.research_status AS company_research_status,
        CASE
            WHEN COALESCE(p.manual_sendable, p.sendable) THEN 'Ready'::text
            ELSE 'Needs a check'::text
        END AS status,
        CASE
            WHEN p.manual_sendable IS TRUE THEN 'Marked ready by hand'::text
            WHEN p.manual_sendable IS FALSE THEN 'Marked not ready by hand'::text
            WHEN p.sendable THEN NULL::text
            WHEN p.list_status IS NULL THEN 'Site visitor — not researched yet'::text
            WHEN p.company_match = 'false'::text THEN 'Works somewhere else — not this account'::text
            WHEN p.list_status = 'unresolved'::text THEN 'Found on LinkedIn only — title unconfirmed'::text
            WHEN p.list_status = 'adjacent'::text THEN 'Title is ambiguous — may not run buildings'::text
            WHEN p.email IS NULL OR p.email = ''::text THEN 'No email yet — look them up'::text
            WHEN p.email_status IS DISTINCT FROM 'verified'::text THEN 'Email found but not confirmed'::text
            ELSE 'Not confirmed'::text
        END AS note,
    p.manual_rank,
    p.manual_sendable,
    COALESCE(p.manual_rank, p.priority, 99) AS rank
   FROM inbound_people p
     JOIN inbound_companies c ON c.id = p.company_id;
