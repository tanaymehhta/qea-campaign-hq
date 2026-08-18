-- Fill a reply's name and company at insert time from `people`, which the sync
-- always populates before it imports the Unibox. A trigger rather than another
-- step in the edge function: it also covers hand-inserted rows and cannot be
-- forgotten in a future refactor of the sync.
create or replace function public.fill_reply_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_email is null then return new; end if;
  if new.lead_name is not null and new.company is not null then return new; end if;

  select coalesce(new.lead_name, p.name), coalesce(new.company, p.company)
    into new.lead_name, new.company
    from people p
   where p.campaign_id = new.campaign_id
     and lower(p.email) = lower(new.lead_email)
   limit 1;

  return new;
end $$;

drop trigger if exists replies_fill_identity on replies;
create trigger replies_fill_identity
  before insert on replies
  for each row execute function public.fill_reply_identity();
