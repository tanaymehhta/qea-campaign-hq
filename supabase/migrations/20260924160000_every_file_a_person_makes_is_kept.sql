-- Every file the staff chat writes, one row per version. The bytes stay in the
-- staff-files bucket at {email}/{id}.docx; this row is what ties them to the
-- person, the thread they came from, and the versions before and after.
-- A version is never overwritten: an edit is a new object and a new row whose
-- parent_id is the version it changed. root_id groups every version of one file.
-- RLS on, no policy, like hq_threads: only the service role reads or writes.

create table if not exists public.staff_files (
  id uuid primary key,
  email text not null references public.app_users (email),
  thread_id uuid references public.hq_threads (id) on delete set null,
  kind text not null check (kind in ('proposal', 'brief')),
  filename text not null,
  root_id uuid not null references public.staff_files (id),
  parent_id uuid references public.staff_files (id),
  change text not null default 'Generated',
  created_at timestamptz not null default now(),
  check ((parent_id is null) = (root_id = id))
);

create index if not exists staff_files_email_created
  on public.staff_files (email, created_at desc);
create index if not exists staff_files_root_created
  on public.staff_files (root_id, created_at);

alter table public.staff_files enable row level security;

-- Files written before this table existed. The chat message that handed each
-- one back names its id and filename, and its thread names the person.
insert into public.staff_files (id, email, thread_id, kind, filename, root_id, created_at)
select distinct on (m.fid)
  m.fid, t.email, t.id,
  case when m.fname ilike '%brief%' then 'brief' else 'proposal' end,
  m.fname, m.fid, m.created_at
from (
  select hm.thread_id, hm.created_at,
         (regexp_matches(hm.content, '\[file:([0-9a-f-]{36}):([^\]]+)\]', 'g')) as mm
  from public.hq_messages hm
) x
cross join lateral (select x.thread_id, x.created_at, x.mm[1]::uuid as fid, x.mm[2] as fname) m
join public.hq_threads t on t.id = m.thread_id
where exists (
  select 1 from storage.objects o
  where o.bucket_id = 'staff-files' and o.name = t.email || '/' || m.fid || '.docx'
)
order by m.fid, m.created_at
on conflict (id) do nothing;
