-- ============================================================
-- The call history table had no way back from a fat-fingered
-- outcome or a call logged against the wrong person — same gap
-- restore_contact closed for do-not-call. Soft delete, not a real
-- DELETE: deleted_at keeps the row in place (and out of every
-- count that reads phone_calls) rather than losing it for good.
-- ============================================================

alter table phone_calls add column deleted_at timestamptz;

create or replace function public.edit_call(
  p_call uuid, p_rep text, p_call_date date, p_outcome text, p_note text, p_callback date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in ('booked_meeting','follow_up','not_interested','no_answer',
                        'left_voicemail','left_email','other') then
    raise exception 'not a valid outcome: %', p_outcome;
  end if;
  if p_call_date is null then
    raise exception 'call date is required';
  end if;

  update phone_calls
     set call_date = p_call_date,
         outcome = p_outcome,
         note = nullif(trim(coalesce(p_note, '')), ''),
         callback_date = p_callback,
         rep = coalesce(nullif(trim(coalesce(p_rep, '')), ''), rep)
   where id = p_call and deleted_at is null;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;
end $$;

create or replace function public.delete_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update phone_calls set deleted_at = now()
   where id = p_call and deleted_at is null;
  if not found then
    raise exception 'no call with id %', p_call;
  end if;
end $$;

grant execute on function public.edit_call(uuid, text, date, text, text, date) to anon, authenticated;
grant execute on function public.delete_call(uuid) to anon, authenticated;
