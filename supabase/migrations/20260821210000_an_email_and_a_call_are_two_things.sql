-- ============================================================
-- An email and a phone call are two things.
--
-- Added as one tag this morning — "Left an email and made a phone call" — and
-- corrected the same day: they are two touches and a rep does one of them at a
-- time. A number that has never been answered and a mailbox that has never
-- replied are different problems and want different next moves.
--
--   not_reached   nobody picked up. A voicemail counts here.
--   left_email    you emailed. Often the only channel: 33 people on the
--                 UNSAFE pilot have an email and no phone at all.
--   made_call     you rang. 50 people have a phone and no email, so for them
--                 this is the only touch that can ever happen.
--
-- None of the three is a conversation. `NOT_REACHED` in lib/calls.js holds all
-- three, so "Spoke to someone" still means a human answered and no tile that
-- counts a reach changes meaning.
--
-- The one row that used the combined tag is Richard Koenigsberg, logged by
-- Tanay this afternoon, and it becomes `made_call` — "I made the phone call",
-- his words. If he emailed as well, the call panel can change it; the note on
-- that row is the Vertify Analytics intel and is untouched either way.
--
-- Only the list changes here. `call_outcomes()` exists precisely so that a
-- fourth change to it is one function and not four places that must agree —
-- the constraint and both plpgsql guards already read it, and none of them are
-- touched by this migration.
-- ============================================================

-- The constraint reads the function, so it has to let go before the list moves
-- under it, and the one existing row has to be moved before it comes back.
alter table public.phone_calls drop constraint if exists phone_calls_outcome_check;

create or replace function public.call_outcomes()
returns text[]
language sql
immutable
parallel safe
as $function$
  select array[
    'booked_meeting',
    'follow_up',
    'not_interested',
    'not_reached',
    'left_email',
    'made_call'
  ]
$function$;

update public.phone_calls
   set outcome = 'made_call'
 where outcome = 'emailed_and_called';

alter table public.phone_calls
  add constraint phone_calls_outcome_check
  check (outcome = any (public.call_outcomes()));

do $check$
begin
  if exists (select 1 from public.phone_calls where outcome = 'emailed_and_called') then
    raise exception 'a call is still on the combined tag';
  end if;
end
$check$;
