-- Instantly's Unibox gives the sender's address but not their name or company.
-- We already know both from `people`, keyed on the same campaign and email, so
-- fill them in rather than showing a bare address on the conflicts screen.
create or replace function public.fill_reply_identities()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update replies r
     set lead_name = coalesce(r.lead_name, p.name),
         company   = coalesce(r.company, p.company)
    from people p
   where p.campaign_id = r.campaign_id
     and lower(p.email) = lower(r.lead_email)
     and (r.lead_name is null or r.company is null)
     and (p.name is not null or p.company is not null);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fill_reply_identities() from public, anon, authenticated;
grant execute on function public.fill_reply_identities() to service_role;

select public.fill_reply_identities();
