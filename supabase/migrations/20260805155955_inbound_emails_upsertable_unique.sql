-- The double-send guard was an expression index on (company_id, lower(person_email)).
-- PostgREST cannot target an expression index with ON CONFLICT, so every upsert failed
-- with 42P10 and stage 3 persisted nothing.
--
-- Case-insensitivity is preserved by construction instead: stage 3 lowercases
-- person_email before writing, so a plain unique constraint is equivalent and is
-- something ON CONFLICT can actually name.
drop index if exists public.inbound_emails_company_email_uidx;

update public.inbound_emails set person_email = lower(person_email)
where person_email <> lower(person_email);

alter table public.inbound_emails
  drop constraint if exists inbound_emails_company_person_email_key;
alter table public.inbound_emails
  add constraint inbound_emails_company_person_email_key
  unique (company_id, person_email);
