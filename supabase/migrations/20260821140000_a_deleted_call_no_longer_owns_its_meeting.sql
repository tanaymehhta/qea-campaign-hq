-- ============================================================
-- A meeting whose call has been deleted can be removed.
--
-- `remove_meeting` refuses any meeting with origin = 'call', and the reason is
-- sound while the call is alive: `log_call` writes the meeting, `edit_call`
-- keeps the two in step, and letting the meeting be struck off on its own would
-- let the call say a meeting was booked while the meetings table said it never
-- existed. One conversation, one answer.
--
-- The guard was too wide by one case. `delete_call` does NOT remove the meeting
-- it created — it sets the status to 'cancelled' and leaves the row on the
-- board (migration 20260820234500). So a deleted call leaves behind a meeting
-- that:
--
--   * still appears on /meetings as a cancellation,
--   * cannot be removed, because origin is still 'call',
--   * and is told to go and change "the call below" — which is deleted, is on
--     no screen, and cannot be changed.
--
-- The advice is unfollowable and the row is stranded. Measured today, one row
-- is in this state: Mark Ellis, 21 Aug, whose booked_meeting call was deleted
-- and re-logged as a follow-up. He is alive on /calls as that follow-up; it is
-- only the meeting that has nowhere to go.
--
-- So the guard keeps its reason and loses the case the reason does not cover: a
-- deleted call owns nothing, and there is no second row left to disagree with.
-- A meeting whose call is still alive is refused exactly as before.
--
-- Nothing else changes. Removal is still the soft delete it has always been —
-- `deleted_at` and a required reason on the `meetings` row, restorable from the
-- bin — and it still never touches `phone_calls`.
-- ============================================================

create or replace function public.remove_meeting(p_meeting uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_reason text; v_origin text; v_call date; v_call_gone boolean;
begin
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'say why it is being removed — the row is kept, and in a month the reason is the only thing that explains it';
  end if;

  -- `v_call_gone` is true when the meeting names a call that is soft-deleted,
  -- and also when it names no call at all — a source_call_id pointing at
  -- nothing is not an owner either.
  select m.origin, pc.call_date, (pc.id is null or pc.deleted_at is not null)
    into v_origin, v_call, v_call_gone
    from meetings m left join phone_calls pc on pc.id = m.source_call_id
   where m.id = p_meeting and m.deleted_at is null;
  if v_origin is null then
    raise exception 'no meeting with that id — it may already have been removed';
  end if;

  if v_origin = 'call' and not v_call_gone then
    raise exception 'this meeting came from a call on % — change that call''s outcome, or delete the call, and this goes with it',
      to_char(v_call, 'DD Mon');
  end if;

  update meetings set deleted_at = now(), removed_reason = v_reason where id = p_meeting;
end $$;

grant execute on function public.remove_meeting(uuid, text) to anon, authenticated;
