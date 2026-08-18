-- Order the notes by what a salesperson most needs to know about that person.
-- "who they are" beats "what field is empty": for the 175 LinkedIn-only rows,
-- "title unconfirmed" is more useful than "no email yet", which is also true of
-- almost everyone right now and therefore says nothing.
create or replace view inbound_people_view
with (security_invoker = true) as
select p.*,
  c.name              as company_name,
  c.research_status   as company_research_status,
  case when p.sendable then 'Ready' else 'Needs a check' end as status,
  case
    when p.sendable                                  then null
    when p.list_status is null                       then 'Site visitor — not researched yet'
    when p.company_match = 'false'                   then 'Works somewhere else — not this account'
    when p.list_status = 'unresolved'                then 'Found on LinkedIn only — title unconfirmed'
    when p.list_status = 'adjacent'                  then 'Title is ambiguous — may not run buildings'
    when p.email is null or p.email = ''             then 'No email yet — look them up'
    when p.email_status is distinct from 'verified'  then 'Email found but not confirmed'
    else 'Not confirmed'
  end as note
from inbound_people p
join inbound_companies c on c.id = p.company_id;

comment on view inbound_people_view is
  'Sales-facing people list: every person found, two statuses (Ready / Needs a check) plus a plain-English note. Filter research_status <> ''not_icp'' to hide rejected accounts.';
