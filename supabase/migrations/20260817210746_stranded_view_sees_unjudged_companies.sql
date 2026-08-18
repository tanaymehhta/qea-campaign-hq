-- v_inbound_stranded missed 46 companies, all research_status='needs_review'.
--
-- The old WHERE admitted a needs_review company only when it had produced nothing
-- (people_named = 0, or people with no drafts). All 46 of these HAVE people and drafts,
-- so the view read them as finished. They are not: their account_type_reason holds an
-- API error instead of a classification, which means the classifier never judged whether
-- they are a fit at all — and their drafts were written on top of that crash.
--
-- "Was output produced" and "was this company ever judged" are different questions. The
-- view now asks both. The new clause admits any company research has been attempted on
-- (anything but 'new') whose reason is missing or is a provider failure, whatever exists
-- downstream of it. The error test mirrors isApiError() in lib/inbound/words.js in the
-- dashboard, so a company the drop-off section calls unresearched is the same company
-- this view calls stranded.
--
-- The new CASE branch sits above the 'not_icp' one on purpose, for the same reason the
-- 'LLM/search failed%' branch does: a not_icp written off a 402 is not a verdict, and
-- calling it 'judged not a fit' is what buried 13 companies in the first place.
create or replace view public.v_inbound_stranded as
 with counts as (
         select c_1.id,
            count(distinct p.id) filter (where coalesce(trim(both from p.first_name), ''::text) <> ''::text) as people_named,
            count(distinct e.id) filter (where e.body is not null) as drafts,
            count(distinct e.id) filter (where e.validator_status = 'sent'::text) as sendable
           from inbound_companies c_1
             left join inbound_people p on p.company_id = c_1.id
             left join inbound_emails e on e.company_id = c_1.id
          group by c_1.id
        )
 select c.id,
    c.name,
    c.domain,
    c.research_status,
    c.account_type,
    c.assigned_to,
    c.first_seen_at,
    c.last_researched_at,
    n.people_named,
    n.drafts,
    n.sendable,
        case
            when c.research_status = 'running'::text and c.updated_at < (now() - '00:30:00'::interval) then 'stage 1 died mid-run'::text
            when c.research_status = any (array['queued'::text, 'error'::text]) then 'never finished stage 1'::text
            when c.account_type_reason ~~ 'LLM/search failed%'::text then 'rejected by a model or billing failure, never judged'::text
            when c.account_type_reason ~~ 'requeued%'::text then 'requeued after a failure, not yet re-run'::text
            when c.account_type_reason ~~ 'outside US/Canada%'::text then 'parked on geography, never researched'::text
            when coalesce(c.research_status, ''::text) <> 'new'::text
                 and (c.account_type_reason is null
                      or c.account_type_reason ~* 'LLM/search failed|Error code:|insufficient credits|rate.?limit|timed out|timeout'::text)
                 then 'research crashed, never judged'::text
            when c.research_status = 'not_icp'::text then 'judged not a fit'::text
            when n.people_named > 0 and n.drafts = 0 then 'people found, no draft written'::text
            when n.people_named = 0 then 'researched, no people found'::text
            else null::text
        end as stranded_reason,
    c.account_type_reason
   from inbound_companies c
     join counts n on n.id = c.id
  where (c.research_status = any (array['queued'::text, 'error'::text, 'not_icp'::text]))
     or c.research_status = 'running'::text and c.updated_at < (now() - '00:30:00'::interval)
     or n.people_named > 0 and n.drafts = 0
     or (c.research_status = any (array['ready'::text, 'needs_review'::text])) and n.people_named = 0
     or (coalesce(c.research_status, ''::text) <> 'new'::text
         and (c.account_type_reason is null
              or c.account_type_reason ~* 'LLM/search failed|Error code:|insufficient credits|rate.?limit|timed out|timeout'::text));
