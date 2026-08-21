-- ============================================================
-- Two ways to not reach someone, and one list of what an outcome is.
--
-- Asked for on 21 Aug 2026. "Didn't reach them" was one tag over two different
-- things a rep does, and the difference matters to the next call:
--
--   not_reached         nobody picked up. Voicemail counts here.
--   emailed_and_called  you rang AND sent an email. Two touches, still no
--                       human — so it is NOT "spoke to someone".
--
-- Neither is a conversation. `callStats.peopleReached` excludes both, and that
-- is the whole reason they are separate from `follow_up`: three tags still mean
-- you got through, and now two mean you did not.
--
-- The history worth knowing, because this looks like a reversal and half of it
-- is: there were seven outcomes until 20 Aug, and "No answer" / "Left
-- voicemail" / "Left email" were collapsed into one because a tile called "No
-- answer" read 6 when no call in the database had ever had that outcome. What
-- was wrong then was three tags for one fact with a tile counting the wrong
-- one. What is added back now is one tag for a genuinely different action —
-- two touches instead of none — and no tile counts it apart.
--
-- WHY A FUNCTION FOR A LIST. The valid outcomes were written out four times:
-- the check constraint, log_call, edit_call, and prose. The list has now
-- changed twice in two days and each change is four edits that must agree.
-- `call_outcomes()` is immutable, so a CHECK constraint can call it, and the
-- next change is one line in one place.
--
-- The two functions are rewritten from their own `pg_get_functiondef`, with
-- only the guard substituted. Everything else about them — the meeting they
-- create, the rep they insist on, the callback they clear — is carried across
-- verbatim rather than retyped, which is the only way to be sure this
-- migration changes exactly one thing.
-- ============================================================

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
    'emailed_and_called'
  ]
$function$;

comment on function public.call_outcomes() is
  'The outcomes a phone call may have. The check constraint on phone_calls and the guards in log_call/edit_call all read this, so there is one list and not four.';

alter table public.phone_calls drop constraint if exists phone_calls_outcome_check;
alter table public.phone_calls
  add constraint phone_calls_outcome_check
  check (outcome = any (public.call_outcomes()));

do $migration$
declare
  v_def text;
  v_old constant text :=
    $lit$p_outcome not in ('booked_meeting', 'follow_up', 'not_interested', 'not_reached')$lit$;
  v_new constant text := $lit$not (p_outcome = any (public.call_outcomes()))$lit$;
  v_patched int := 0;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('log_call', 'edit_call')
  loop
    if position(v_old in v_def) = 0 then
      raise exception 'guard not found — a function was changed under this migration; re-read it before rerunning';
    end if;
    execute replace(v_def, v_old, v_new);
    v_patched := v_patched + 1;
  end loop;

  -- Both, or the two doors into phone_calls disagree about what an outcome is.
  if v_patched <> 2 then
    raise exception 'patched % functions, expected 2', v_patched;
  end if;
end
$migration$;
