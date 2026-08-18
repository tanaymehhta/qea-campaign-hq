-- A group with no owner is invisible to the rep layer, and the only fix was SQL.
--
-- `repList()` skips a group whose `owner` is null, so it gets no rep avatar, no
-- rep filter on the Overview, and no entry in the /calls roster. It is the one
-- blank field on `campaign_groups` that costs a feature rather than a label —
-- and the group is not broken in any way a person can see, which is why
-- `ungrouped` has sat like that since it was auto-created.
--
-- Two pieces: something for /health to list, and a validating write.
--
-- `set_group_owner` follows the pattern already used by classify_reply and
-- record_meeting_detail — security definer, validates its own arguments, and can
-- touch exactly one column of one row. It cannot insert, delete, or reach any
-- other table, so a malformed or hostile call fails in the database rather than
-- being trusted because it arrived from our own interface.
--
-- Note it deliberately does NOT restrict the owner to an existing rep. There is
-- no rep table — reps are derived from who owns a group (lib/db.js repList) —
-- so requiring an existing owner would make the first owner of a new name
-- unaddable. The interface offers the known names and accepts a new one.
create or replace view v_groups_without_an_owner as
select g.id, g.slug, g.display_name, g.status,
       v.actual_status, v.campaign_count, v.running_count, v.sent, v.last_sent_on
from campaign_groups g
join v_group_summary v on v.id = g.id
where nullif(trim(coalesce(g.owner, '')), '') is null;

grant select on v_groups_without_an_owner to anon, authenticated;

create or replace function public.set_group_owner(p_group uuid, p_owner text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner text;
begin
  v_owner := nullif(trim(coalesce(p_owner, '')), '');
  if v_owner is null then
    raise exception 'an owner name is required';
  end if;
  if length(v_owner) > 80 then
    raise exception 'that name is too long — keep it under 80 characters';
  end if;

  update campaign_groups set owner = v_owner where id = p_group;
  if not found then
    raise exception 'no campaign group with id %', p_group;
  end if;
end $$;

revoke all on function public.set_group_owner(uuid, text) from public;
grant execute on function public.set_group_owner(uuid, text) to anon, authenticated;
