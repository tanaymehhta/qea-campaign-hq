-- Every company the pipeline started and did not finish, with why and how to resume.
-- The dashboard lists this and its "Research this" button is one write:
--   update inbound_companies set research_status='new' where id = $1
-- which is exactly what run_pipeline.py --all-new already picks up. No new API needed.
create or replace view public.v_inbound_stranded as
with counts as (
  select c.id,
         count(distinct p.id) filter (where coalesce(trim(p.first_name),'') <> '') people_named,
         count(distinct e.id) filter (where e.body is not null) drafts,
         count(distinct e.id) filter (where e.validator_status = 'sent') sendable
  from public.inbound_companies c
  left join public.inbound_people p on p.company_id = c.id
  left join public.inbound_emails e on e.company_id = c.id
  group by c.id
)
select c.id, c.name, c.domain, c.research_status, c.account_type, c.assigned_to,
       c.first_seen_at, c.last_researched_at,
       n.people_named, n.drafts, n.sendable,
       case
         when c.research_status = 'running'
              and c.updated_at < now() - interval '30 minutes'
           then 'stage 1 died mid-run'
         when c.research_status in ('queued', 'error')
           then 'never finished stage 1'
         when c.account_type_reason like 'LLM/search failed%'
           then 'rejected by a model or billing failure, never judged'
         when c.account_type_reason like 'requeued%'
           then 'requeued after a failure, not yet re-run'
         when c.account_type_reason like 'outside US/Canada%'
           then 'parked on geography, never researched'
         when c.research_status = 'not_icp'
           then 'judged not a fit'
         when n.people_named > 0 and n.drafts = 0
           then 'people found, no draft written'
         when n.people_named = 0
           then 'researched, no people found'
       end as stranded_reason,
       c.account_type_reason
from public.inbound_companies c
join counts n on n.id = c.id
where c.research_status in ('queued', 'error', 'not_icp')
   or (c.research_status = 'running' and c.updated_at < now() - interval '30 minutes')
   or (n.people_named > 0 and n.drafts = 0)
   or (c.research_status in ('ready', 'needs_review') and n.people_named = 0);

comment on view public.v_inbound_stranded is
  'Companies the pipeline started and did not finish. Resume one by setting inbound_companies.research_status=''new''; the next --all-new run picks it up.';
