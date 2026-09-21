-- Staff chat. Separate from chat.turns, which belongs to the customer chatbot.
-- RLS on, no policy: anon and authenticated see nothing. The server writes
-- with the service role, and only after the session email matches the row.

alter table public.app_users add column if not exists person_notes text;

alter table public.app_users drop constraint if exists app_users_person_notes_cap;
alter table public.app_users
  add constraint app_users_person_notes_cap
  check (person_notes is null or char_length(person_notes) <= 2000);

create table if not exists public.hq_threads (
  id uuid primary key default gen_random_uuid(),
  email text not null references public.app_users (email),
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.hq_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.hq_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists hq_threads_email_created
  on public.hq_threads (email, created_at desc);
create index if not exists hq_messages_thread_created
  on public.hq_messages (thread_id, created_at);

alter table public.hq_threads enable row level security;
alter table public.hq_messages enable row level security;
