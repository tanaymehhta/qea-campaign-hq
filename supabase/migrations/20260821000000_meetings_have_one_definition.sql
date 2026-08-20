-- ============================================================
-- Meetings: one definition, finished.
--
-- The 20 Aug migration (20260820174533) wrote `meeting_rows` to be the single
-- answer to "is this meeting in this scope", and converted two of the four
-- readers to it. This converts the other two, and closes the hole the first one
-- left open in its own scope clause.
--
-- Measured live on the evening of 20 Aug 2026, after that migration shipped:
--
--   /campaigns/qea-resellers   "Meetings"  1
--   its own href               /list?metric=meetings&range=all&group=qea-resellers
--   rows behind it             2
--
--   /meetings rep strip        All 9 · Mark Vasu 7 · Justin 0 · Mark Dolan 1
--                              7 + 0 + 1 = 8, and the all-reps total says 9.
--
--   /?rep=Mark Vasu            8        /meetings?rep=Mark Vasu   7
--
-- Three faults, one cause: scope lives in three columns and every reader picks
-- a different subset of them.
--
-- ---------------------------------------------------------------------------
-- Fault 1 — a meeting could belong to two reps, or to none.
--
-- `meeting_rows` computes `rep` for display with one expression and scopes with
-- a *different* one:
--
--   display   coalesce(cg.owner, <campaign's group owner>, cc.owner, pc.rep, logged_by)
--   scope     pc.rep = p_rep OR cc.owner = p_rep OR (unscoped AND logged_by = p_rep)
--
-- Two consequences. A call whose rep differs from the owner of the call
-- campaign matches **both** names, so per-rep totals sum to more than the
-- all-reps total. And a call logged with the rep box empty resolves to nobody,
-- so they sum to less — which is the 8-vs-9 above, reproduced by logging one
-- call with no rep.
--
-- The fix is not a better OR. It is to resolve the rep **once**, scope on that
-- single value, and return the same value for display. A meeting then belongs
-- to exactly one rep by construction, and "the rep totals sum" stops being
-- something to check and becomes something the shape of the query guarantees.
--
-- ---------------------------------------------------------------------------
-- Fault 2 — `p_rep` and the scope doors could not both be honoured.
--
-- A meeting arrives through three doors: a campaign, a group, or a phone call.
-- A call meeting has neither of the first two — which is why the old clause had
-- to OR the doors together with the rep, and why ANDing them instead would have
-- made Baris Acar vanish from /?rep=Mark Vasu.
--
-- Resolving the rep once makes the question go away: `resolved_rep` already
-- encodes all three doors. So **when p_rep is given it is the whole scope**, and
-- the campaign and group arrays are ignored. That is not a loss — passing both
-- is redundant by construction, and neither caller in this codebase does it.
-- The Overview passes a rep and no door; a campaign drill-down passes a door and
-- no rep. Documented here because the alternative reading (intersect them) is
-- the one a future caller will assume.
--
-- ---------------------------------------------------------------------------
-- Fault 3 — the campaign summaries cannot see a group-scoped meeting.
--
-- `v_campaign_summary.meetings` counts `mt.campaign_id = c.id`. The hand form
-- sets `group_id` and never `campaign_id`. `v_group_summary.meetings` is
-- `sum()` over those campaign rows, so a meeting logged against a group is
-- invisible to both — group totals sum to 3 while the Overview says 5, and
-- Krishnan Gowri appears in neither.
--
-- Settled by Tanay, 20 Aug 2026: the **group** summary counts them, the
-- sub-campaign rows do not. A sub-campaign row means "meetings attributed to
-- this sub-campaign" and a group meeting genuinely is not one — but the group
-- tile is what a rep reads, and it has to agree with `meeting_rows`. The
-- consequence, accepted: sub-campaign rows will legitimately sum to less than
-- the group tile above them, and /campaigns/[slug] says so in a line.
--
-- ---------------------------------------------------------------------------
-- Fault 4 — `record_meeting_detail` could orphan a meeting from every rep.
--
-- Filling in a blank name on /conflicts overwrote `logged_by` with the literal
-- 'dashboard'. For a meeting with no group, no campaign and no call — which is
-- exactly the kind that ends up on /conflicts — `logged_by` is the only thing
-- left to resolve a rep from. Settling a conflict therefore removed the meeting
-- from every rep's view while leaving it in the all-reps total, breaking the
-- invariant this migration exists to establish.
--
-- No live row carries it (checked: all 7 rows read a real name or null), so this
-- is preventative. `logged_by` means "who typed it in" and a correction is not
-- that, so the column is simply left alone now.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1 · meeting_rows / meeting_counts
--
-- Dropped and recreated rather than replaced: `p_status` is a new argument and
-- therefore a new signature, and leaving the five-argument version in place
-- would give PostgREST two candidates and let an old caller keep asking the
-- question the wrong way. Same reasoning 20260820174533 gave for log_call.
-- counts first — it depends on rows.
drop function if exists public.meeting_counts(date, date, uuid[], uuid[], text);
drop function if exists public.meeting_rows(date, date, uuid[], uuid[], text);

create or replace function public.meeting_rows(
  p_from date, p_to date, p_campaigns uuid[], p_groups uuid[], p_rep text,
  p_status text default 'counted'
) returns table (
  id uuid, campaign_id uuid, group_id uuid,
  prospect_name text, prospect_email text, company text,
  meeting_date date, booked_on date, scope_date date,
  status text, evidence text, note text, origin text,
  source_call_id uuid, logged_by text, rep text,
  scope_label text, group_slug text
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with resolved as (
    select m.id, m.campaign_id, m.group_id,
           m.prospect_name, m.prospect_email, m.company,
           m.meeting_date, m.booked_on,
           coalesce(m.booked_on, m.meeting_date) as scope_date,
           m.status, m.evidence, m.note, m.origin, m.source_call_id, m.logged_by,
           -- The one answer. Display and scope read this same column, so the
           -- name a list prints is provably the name that selected the row.
           -- Order is the union of what the three readers did before this,
           -- in the priority /meetings already used: the group that owns it,
           -- then the group behind its campaign, then whoever made the call,
           -- then whoever owns the list that call came from, then whoever
           -- typed it in.
           coalesce(cg.owner, gm.owner, pc.rep, cc.owner, m.logged_by) as rep,
           -- What to print in a "Campaign" cell, resolved here so no page has
           -- to. A meeting logged against a group used to read "campaign
           -- unknown" because every page looked only at campaign_id — the one
           -- field the form asks for was invisible the moment it was saved.
           coalesce(cg.display_name, gm.display_name, cc.display_name) as scope_label,
           -- Null for a call meeting on purpose: its label names a call
           -- campaign, which lives under /calls and not /campaigns, so a page
           -- linking on this cannot send anyone to a page that does not exist.
           coalesce(cg.slug, gm.slug) as group_slug
      from meetings m
      left join campaign_groups cg on cg.id = m.group_id
      left join lateral (
        select g.owner, g.display_name, g.slug
          from campaign_group_members mm
          join campaign_groups g on g.id = mm.group_id
         where mm.campaign_id = m.campaign_id
         order by g.sort_order nulls last
         limit 1
      ) gm on true
      left join phone_calls    pc on pc.id = m.source_call_id
      left join call_contacts  ct on ct.id = pc.contact_id
      left join call_campaigns cc on cc.id = ct.call_campaign_id
  )
  select r.id, r.campaign_id, r.group_id,
         r.prospect_name, r.prospect_email, r.company,
         r.meeting_date, r.booked_on, r.scope_date,
         r.status, r.evidence, r.note, r.origin,
         r.source_call_id, r.logged_by, r.rep,
         r.scope_label, r.group_slug
    from resolved r
   where (case
            when p_status = 'all' then true
            else r.status in ('booked', 'held')
          end)
     and (p_from is null or r.scope_date >= p_from)
     and (p_to   is null or r.scope_date <= p_to)
     -- A rep, when given, IS the scope — see Fault 2 above. Otherwise the two
     -- doors, and no door at all means every meeting, which is "all reps, all
     -- campaigns" rather than "nothing matched".
     and (case
            when p_rep is not null then r.rep = p_rep
            when p_campaigns is null and p_groups is null then true
            else coalesce(r.campaign_id = any (p_campaigns), false)
              or coalesce(r.group_id    = any (p_groups), false)
          end)
$function$;

comment on function public.meeting_rows(date, date, uuid[], uuid[], text, text) is
  'The only answer to "is this meeting in this scope". Every reader asks this —
   the Overview tile, /list, /meetings and the group summary. p_rep, when given,
   is the whole scope and the campaign/group arrays are ignored: the returned
   rep already encodes all three doors a meeting can arrive through, so a
   meeting belongs to exactly one rep and per-rep totals sum to the all-reps
   total by construction. p_status is ''counted'' (booked + held, what every
   KPI counts) or ''all'' (every status, which /meetings lists).';

create or replace function public.meeting_counts(
  p_from date, p_to date, p_campaigns uuid[], p_groups uuid[], p_rep text,
  p_status text default 'counted'
) returns table (meetings bigint, people bigint, from_calls bigint)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select count(*)::bigint,
         count(distinct coalesce(
           lower(nullif(trim(coalesce(r.prospect_email, '')), '')),
           lower(trim(coalesce(r.prospect_name, '')))
         ))::bigint,
         count(*) filter (where r.source_call_id is not null)::bigint
    from meeting_rows(p_from, p_to, p_campaigns, p_groups, p_rep, p_status) r
$function$;

grant execute on function public.meeting_rows(date, date, uuid[], uuid[], text, text)
  to anon, authenticated;
grant execute on function public.meeting_counts(date, date, uuid[], uuid[], text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 · v_group_summary counts a group's own meetings, not only its campaigns'.
--
-- Cast to numeric because `create or replace view` will not change a column's
-- type, and the expression this replaces was sum() over numeric.
--
-- Deliberately a correlated subquery rather than a call to meeting_rows(): a
-- security-invoker set-returning function once per group row inside a grouped
-- view is a lot of machinery for a count over seven rows. It must agree with
-- meeting_rows for the group door, and the parity script asserts that it does.
create or replace view v_group_summary as
 SELECT g.id,
    g.slug,
    g.display_name,
    g.vault_name,
    g.status,
    g.owner,
        CASE
            WHEN ((g.platform IS NULL) OR (cardinality(g.platform) = 0)) THEN ( SELECT array_agg(DISTINCT c.source ORDER BY c.source) AS array_agg
               FROM (campaign_group_members m2
                 JOIN campaigns c ON ((c.id = m2.campaign_id)))
              WHERE (m2.group_id = g.id))
            ELSE g.platform
        END AS platform,
    g.geography,
    g.segment,
    g.list_source,
    g.sequence_shape,
    g.started_on,
    g.description,
    count(s.campaign_id) AS campaign_count,
    count(*) FILTER (WHERE (s.status = 'running'::text)) AS running_count,
    count(*) FILTER (WHERE (s.status = 'paused'::text)) AS paused_count,
    count(*) FILTER (WHERE (s.status = 'draft'::text)) AS draft_count,
    COALESCE(sum(s.leads), (0)::bigint) AS leads,
    COALESCE(sum(s.sent), (0)::bigint) AS sent,
    COALESCE(sum(s.delivered), (0)::bigint) AS delivered,
    COALESCE(sum(s.bounced), (0)::bigint) AS bounced,
    COALESCE(sum(s.opened), (0)::bigint) AS opened,
    COALESCE(sum(s.replied), (0)::bigint) AS replied,
    COALESCE(sum(s.linkedin_accepted), (0)::bigint) AS linkedin_accepted,
    (( SELECT count(*) AS count
           FROM meetings mt
          WHERE ((mt.status = ANY (ARRAY['booked'::text, 'held'::text]))
             AND ((mt.group_id = g.id)
               OR (mt.campaign_id IN ( SELECT mm.campaign_id
                     FROM campaign_group_members mm
                    WHERE (mm.group_id = g.id)))))))::numeric AS meetings,
    COALESCE(sum(s.positive_replies), (0)::numeric) AS positive_replies,
    COALESCE(sum(s.proposals), (0)::numeric) AS proposals,
    dates.first_sent_on,
    dates.last_sent_on,
        CASE
            WHEN ((count(*) FILTER (WHERE (s.status = 'running'::text)) > 0) AND (dates.last_sent_on >= (CURRENT_DATE - 14))) THEN 'live'::text
            WHEN (COALESCE(sum(s.sent), (0)::bigint) > 0) THEN 'ended'::text
            ELSE 'planned'::text
        END AS actual_status,
    g.sort_order
   FROM ((campaign_groups g
     LEFT JOIN v_campaign_summary s ON ((s.group_id = g.id)))
     LEFT JOIN ( SELECT m.group_id,
            min(d.metric_date) FILTER (WHERE (d.sent > 0)) AS first_sent_on,
            max(d.metric_date) FILTER (WHERE (d.sent > 0)) AS last_sent_on
           FROM (daily_metrics d
             JOIN campaign_group_members m ON ((m.campaign_id = d.campaign_id)))
          GROUP BY m.group_id) dates ON ((dates.group_id = g.id)))
  GROUP BY g.id, g.slug, g.display_name, g.vault_name, g.status, g.owner, g.platform, g.geography, g.segment, g.list_source, g.sequence_shape, g.started_on, g.description, g.sort_order, dates.first_sent_on, dates.last_sent_on;

-- ---------------------------------------------------------------------------
-- 3 · Settling a conflict no longer takes the meeting away from its rep.
create or replace function public.record_meeting_detail(
  p_meeting uuid, p_name text, p_company text, p_email text, p_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update meetings
     set prospect_name  = coalesce(nullif(trim(p_name), ''), prospect_name),
         company        = coalesce(nullif(trim(p_company), ''), company),
         prospect_email = coalesce(nullif(trim(p_email), ''), prospect_email),
         note           = coalesce(nullif(trim(p_note), ''), note)
         -- logged_by is NOT touched. It records who typed the meeting in, and
         -- for an unscoped meeting it is the only thing meeting_rows can
         -- resolve a rep from. Overwriting it with 'dashboard' removed the
         -- meeting from every rep's view while leaving it in the all-reps
         -- total — see Fault 4 in this migration's header.
   where id = p_meeting;
  if not found then
    raise exception 'no meeting with id %', p_meeting;
  end if;
end $$;

grant execute on function public.record_meeting_detail(uuid, text, text, text, text)
  to anon, authenticated;
