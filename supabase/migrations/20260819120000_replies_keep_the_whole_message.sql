-- ============================================================
-- The message, not a preview of it.
--
-- `replies.body` has been holding Instantly's `content_preview` since the
-- table existed. That field stops at 60 characters. Read on 19 Aug 2026, 33 of
-- the 39 unlabelled replies were fragments — a third of them nothing but
-- "Mark," or "Hi Mark," — and nobody can decide interested from not interested
-- against that. The full text was in the same API response all along, under
-- `body.text`, and the sync was dropping it.
--
-- Fixing the sync alone changes nothing for the rows already here. The reply
-- upsert runs with ignoreDuplicates, so a message written once is never
-- touched again — deliberately, because that is what protects a human's label
-- from being overwritten by the next sync's guess.
--
-- So the two needs are split rather than traded off. This function updates
-- what the vendor owns (the text of the message) and refuses to touch what a
-- person owns (what the message means). `sentiment`, `classified_by` and
-- `classified_at` are absent from the DO UPDATE list, which is the whole
-- point: re-running the sync over a labelled reply repairs its body and leaves
-- the judgment intact.
-- ============================================================

create or replace function public.ingest_replies(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ingest_replies expects a json array, got %', jsonb_typeof(p_rows);
  end if;

  insert into replies (
    campaign_id, source, source_message_id, lead_email, lead_name, company,
    channel, received_at, subject, body, sentiment, classified_by, classified_at
  )
  select
    (r->>'campaign_id')::uuid,
    r->>'source',
    r->>'source_message_id',
    r->>'lead_email',
    r->>'lead_name',
    r->>'company',
    coalesce(r->>'channel', 'email'),
    (r->>'received_at')::timestamptz,
    r->>'subject',
    r->>'body',
    coalesce(r->>'sentiment', 'unclassified'),
    r->>'classified_by',
    (r->>'classified_at')::timestamptz
  from jsonb_array_elements(p_rows) as r
  on conflict (source, source_message_id) do update
    -- Vendor facts only. Everything a person decides is missing from this list
    -- on purpose; see the header.
    set body       = coalesce(excluded.body, replies.body),
        subject    = coalesce(excluded.subject, replies.subject),
        lead_name  = coalesce(excluded.lead_name, replies.lead_name),
        company    = coalesce(excluded.company, replies.company);

  get diagnostics n = row_count;
  return n;
end $$;

-- The sync calls this with the service role. The anon key gets nothing here:
-- the only write the dashboard may make to this table is classify_reply, which
-- is the mirror image of this function — it sets the judgment and never the
-- text.
--
-- Revoking from PUBLIC takes execute away from service_role too, so the grant
-- is not decoration — without it the next sync fails on permission denied.
revoke all on function public.ingest_replies(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_replies(jsonb) to service_role;
