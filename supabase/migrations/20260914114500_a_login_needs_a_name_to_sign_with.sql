-- ============================================================
-- A login needs a name to sign with.
--
-- Microsoft can prove someone holds justin@qeatech.com. It cannot know that the
-- data in this database calls that person `Justin` — a free-text string sitting
-- in four different columns (campaign_groups.owner, call_campaigns.owner,
-- phone_calls.rep, meetings.logged_by). This table is the join between the two,
-- and that is now its only job.
--
-- It started life in AUTH_PLAN section 6 as an allowlist with a `role` column.
-- Tanay settled both away on 14 Sep: everyone with a QEA account is allowed in,
-- and everyone is an admin. So the gate is gone (Entra's "this organizational
-- directory only" is the only gate left) and the role column is gone with it —
-- there is nothing left for it to distinguish. If roles ever come back, they
-- come back as one column and a few conditionals, which is cheaper than
-- carrying a column that always says the same word.
--
-- What did NOT go away is `rep_name`, and it must match those owner strings
-- CHARACTER FOR CHARACTER. A mismatch raises nothing anywhere: the person signs
-- in fine and sees zero campaigns as theirs, which reads as a bug rather than
-- as a typo.
--
-- Note the two Marks. `mark@` is Dolan, `mark.vasu@` is Vasu. Swapping them
-- silently reassigns sixteen logged calls' worth of scope, and nothing would
-- complain.
--
-- A QEA address with no row here still signs in and still reads everything.
-- What it cannot do is write, because a write has to be signed and there is no
-- name to sign it with. Deriving one from the email local part was the
-- tempting shortcut and is the exact failure 11c exists to prevent: a name on a
-- call that nobody can vouch for. Adding the row is one line in the Table
-- Editor and takes effect on their next page load.
--
-- RLS is on and there is DELIBERATELY NO POLICY. With no policy, anon and
-- authenticated read nothing and the only client that can see this table is the
-- server on the service role. This is why lib/auth.js needs a service-role key
-- and cannot do its lookup on the anon client.
-- ============================================================

create table if not exists public.app_users (
  email        text primary key,
  display_name text not null,
  rep_name     text,
  created_at   timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- Entra can return a mixed-case `email` claim, so the stored form is lowercase
-- and every comparison lowercases its input. The constraint makes the storage
-- half of that rule impossible to break by hand in the Table Editor.
alter table public.app_users drop constraint if exists app_users_email_is_lowercase;
alter table public.app_users
  add constraint app_users_email_is_lowercase check (email = lower(email));

insert into public.app_users (email, display_name, rep_name) values
  ('tanay@qeatech.com',     'Tanay',      'Tanay'),
  ('justin@qeatech.com',    'Justin',     'Justin'),
  ('mark@qeatech.com',      'Mark Dolan', 'Mark Dolan'),
  ('mark.vasu@qeatech.com', 'Mark Vasu',  'Mark Vasu')
on conflict (email) do nothing;

-- The join asserted once rather than trusted: a rep_name that matches nothing
-- is a typo that would not surface until that person signed in and found an
-- empty dashboard.
--
-- Tanay is the exception, and is listed by name rather than by a rule. He owned
-- groups when AUTH_PLAN section 1.4 was written on 17 Aug;
-- 20260820180000_qea_resellers_and_lber_move_to_mark_vasu moved his last one
-- three days later, so `Tanay` now matches no owner string in any table. That
-- is a true fact about the data, not a typo, and hard-coding the one known
-- exception keeps the check strict for everybody else.
do $check$
declare
  orphan text;
begin
  select u.rep_name into orphan
    from public.app_users u
   where u.rep_name is not null
     and u.rep_name <> 'Tanay'
     and not exists (select 1 from public.campaign_groups g where g.owner = u.rep_name)
     and not exists (select 1 from public.call_campaigns c where c.owner = u.rep_name)
     and not exists (select 1 from public.phone_calls p where p.rep = u.rep_name)
     and not exists (select 1 from public.meetings m where m.logged_by = u.rep_name)
   limit 1;
  if orphan is not null then
    raise exception 'rep_name % matches no owner string in any table', orphan;
  end if;
end
$check$;
