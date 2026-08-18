-- Stage 3 now drafts for every person found, not only `list_status='contact'`.
-- Most of those people have no email yet (Apollo cannot reveal without credits), so
-- person_email can no longer be the identity of a draft: it was NOT NULL and it was
-- half the unique key, which meant a person with no address could not be stored at all.
-- person_id already existed, is on every person, and is what a draft is actually about.

alter table inbound_emails alter column person_email drop not null;

-- Backfill before the new constraint can be trusted. persist() never set person_id.
update inbound_emails e
   set person_id = p.id
  from inbound_people p
 where e.person_id is null
   and p.company_id = e.company_id
   and lower(p.email) = lower(e.person_email);

alter table inbound_emails drop constraint if exists inbound_emails_company_person_email_key;

-- One draft per person per company. A re-run updates rather than queueing a second email.
create unique index if not exists inbound_emails_company_person_uidx
  on inbound_emails (company_id, person_id);
