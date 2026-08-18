-- Two labels for a salesperson, derived — no new column, nothing to keep in sync.
-- `list_status`/`sendable` stay the machine's truth; this is the human view.
create or replace view inbound_people_view
with (security_invoker = true) as
select p.*,
  c.name              as company_name,
  c.research_status   as company_research_status,
  case when p.sendable then 'Ready' else 'Needs a check' end as status,
  case
    when p.sendable                                  then null
    when p.list_status is null                       then 'Site visitor — not researched yet'
    when p.email is null or p.email = ''             then 'No email yet — look them up'
    when p.email_status is distinct from 'verified'  then 'Email found but not confirmed'
    when p.company_match = 'false'                   then 'Works somewhere else — not this account'
    when p.last_name is null or p.last_name = ''     then 'Surname unknown — first name is right'
    when p.list_status = 'adjacent'                  then 'Title is ambiguous — may not run buildings'
    when p.list_status = 'unresolved'                then 'Found on LinkedIn only — title unconfirmed'
    else 'Not confirmed'
  end as note
from inbound_people p
join inbound_companies c on c.id = p.company_id;

comment on view inbound_people_view is
  'Sales-facing people list: every person found, two statuses (Ready / Needs a check) plus a plain-English note. Filter research_status <> ''not_icp'' to hide rejected accounts.';
