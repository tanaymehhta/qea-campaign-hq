-- Sending feedback now starts the work. The button that used to stand between
-- the two is gone, so submit_feedback has to hand back the row it made: the
-- caller needs the id to name the branch and to record that it was asked.
--
-- Returning a value rather than raising a second query at it, because the id is
-- generated inside this function and nothing outside can know it otherwise.
--
-- Dropped first: postgres will not let create or replace change a return type.
drop function if exists public.submit_feedback(text, text, text, text);

create function public.submit_feedback(
  p_page text, p_rep text, p_body text, p_screenshot text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
  v_id   uuid;
begin
  v_body := nullif(trim(coalesce(p_body, '')), '');
  if v_body is null then
    raise exception 'say something first -- the box is empty';
  end if;
  if length(v_body) > 5000 then
    raise exception 'that is too long for this box -- keep it under 5,000 characters';
  end if;

  insert into feedback (page, rep, body, screenshot)
  values (coalesce(nullif(trim(coalesce(p_page, '')), ''), 'unknown'),
          nullif(trim(coalesce(p_rep, '')), ''),
          v_body,
          nullif(trim(coalesce(p_screenshot, '')), ''))
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.submit_feedback(text, text, text, text) to anon, authenticated;
