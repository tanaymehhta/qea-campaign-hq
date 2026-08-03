-- ============================================================
-- Feedback: a box on every page so the people using this thing
-- can say what's wrong or missing from where they noticed it,
-- and a page to read what came in.
--
-- The page it was sent from is not asked for — it comes from the
-- Referer header on the POST, so a report costs one sentence and
-- nothing else. Same reason the rep is lifted from ?rep= rather
-- than being another field to fill in.
-- ============================================================

create table feedback (
  id          uuid primary key default gen_random_uuid(),
  page        text not null default 'unknown',  -- pathname + query it was sent from
  rep         text,                             -- from ?rep=, when the page had one
  body        text not null,
  screenshot  text,                             -- object path in the 'feedback' bucket
  status      text not null default 'open'
              check (status in ('open','done')),
  created_at  timestamptz not null default now()
);

alter table feedback enable row level security;
create policy "public read" on public.feedback for select to anon, authenticated using (true);

-- Screenshots. A bucket rather than a column: 2 MB of PNG does not belong in
-- a row that gets selected on every page load.
--
-- The site has no login, so the anon key is what uploads — the same trust
-- model as every other write here. What keeps that from being an open dumping
-- ground is the bucket itself: images only, 5 MB each, enforced by storage
-- rather than by us remembering to check.
-- ponytail: if it is ever abused, move the upload behind a token-guarded edge
-- function holding the service key, like import-call-list already does.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "feedback screenshots upload" on storage.objects;
create policy "feedback screenshots upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'feedback');

drop policy if exists "feedback screenshots read" on storage.objects;
create policy "feedback screenshots read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'feedback');

-- ------------------------------------------------------------------
-- Write path — validated in the database like every other write here.
-- ------------------------------------------------------------------

create or replace function public.submit_feedback(
  p_page text, p_rep text, p_body text, p_screenshot text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_body text;
begin
  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null then
    raise exception 'say something first — the box is empty';
  end if;
  -- A paragraph or two is feedback. A novel is someone pasting a log, or a bot.
  if length(v_body) > 5000 then
    raise exception 'that is too long for this box — keep it under 5,000 characters';
  end if;

  insert into feedback (page, rep, body, screenshot)
  values (coalesce(nullif(trim(coalesce(p_page, '')), ''), 'unknown'),
          nullif(trim(coalesce(p_rep, '')), ''),
          v_body,
          nullif(trim(coalesce(p_screenshot, '')), ''));
end $$;

create or replace function public.set_feedback_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('open','done') then
    raise exception 'not a valid status: %', p_status;
  end if;
  update feedback set status = p_status where id = p_id;
  if not found then
    raise exception 'no feedback with id %', p_id;
  end if;
end $$;

grant execute on function public.submit_feedback(text, text, text, text) to anon, authenticated;
grant execute on function public.set_feedback_status(uuid, text)         to anon, authenticated;
