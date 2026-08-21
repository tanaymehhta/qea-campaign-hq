-- The press was invisible. A dispatch left no trace anywhere in this database,
-- so /feedback could not tell "nobody has asked for this yet" apart from
-- "Claude has been working on it for ninety seconds", and the button sat there
-- looking unpressed either way.
--
-- One column is enough. Everything else about the run -- whether it finished,
-- what it opened, where to look at it -- is already known to GitHub, and asking
-- GitHub at render time beats keeping a second copy of it here that can drift.
alter table feedback add column if not exists asked_at timestamptz;

create or replace function public.mark_feedback_asked(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update feedback set asked_at = now() where id = p_id;
  if not found then
    raise exception 'no feedback with id %', p_id;
  end if;
end $$;

grant execute on function public.mark_feedback_asked(uuid) to anon, authenticated;
