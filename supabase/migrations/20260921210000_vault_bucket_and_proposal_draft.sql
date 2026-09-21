-- Private copies the staff chat reads. The vault bucket holds one markdown
-- object per canonical wiki page. staff-files holds drafts for that email.
-- No storage policy: anon cannot read them. The service role does.

insert into storage.buckets (id, name, public)
values ('vault', 'vault', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('staff-files', 'staff-files', false)
on conflict (id) do nothing;

alter table public.hq_threads
  add column if not exists proposal_conversation jsonb;

alter table public.hq_threads
  add column if not exists accepted_at timestamptz;
