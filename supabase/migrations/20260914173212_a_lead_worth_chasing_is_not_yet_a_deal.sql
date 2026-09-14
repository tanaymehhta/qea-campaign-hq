-- ============================================================
-- A lead worth chasing is not yet a deal.
--
-- "Colleen is the best person to manage roof repairs." "At the moment we don't
-- need these, but keep us in mind." Both need chasing and neither is a deal:
-- the first names somebody who has not written to us, the second names a date
-- that has not arrived. Pushed to HubSpot they become deals nobody can work —
-- SunFlow got one on 14 Sep carrying the name of the company that had just
-- declined and pointed elsewhere, and it was deleted by hand the same hour.
--
-- `referral` and `not_now` have been legal values of replies.sentiment since
-- the table was built, and had never been used; /conflicts has offered both as
-- buttons the whole time. Nothing is added here. The words already existed —
-- the work was deciding what they mean and who reads them.
--
-- They count as interested on every tile, because the question a tile answers
-- is "who is worth a follow-up" and both of these are. They do not reach
-- HubSpot, because the question a deal answers is "who is a live opportunity"
-- and neither is one yet. One column, two readers, two different questions —
-- which is why the push reads replies.sentiment directly rather than this flag.
-- ============================================================

-- ---------------------------------------------------------------- the flag
--
-- Only the `interested` expression changes, and the signature must not:
-- v_invariants selects response_counts into an explicit five-column list and
-- response_counts reads this function, so widening either shape would break the
-- very view that exists to catch silent drift of this kind.
--
-- Widening the flag rather than adding a bucket beside it is also what keeps
-- the Not-interested tile honest. That tile is `responded - interested`, and
-- with a third bucket it would have gone on filing referrals as refusals while
-- the parts still added up — which is what would have stopped anyone noticing.
create or replace function public.response_people(
  p_from date default null, p_to date default null,
  p_campaigns uuid[] default null, p_source text default 'instantly'
)
returns table(lead_email text, lead_name text, company text, sources text[],
              labels text[], msgs integer, first_at timestamptz, last_at timestamptz,
              responded boolean, interested boolean, needs_label boolean, robot_only boolean)
language sql stable set search_path to 'public'
as $function$
  select
    lower(r.lead_email),
    (array_agg(r.lead_name order by r.received_at desc)
       filter (where nullif(trim(r.lead_name), '') is not null))[1],
    (array_agg(r.company   order by r.received_at desc)
       filter (where nullif(trim(r.company),   '') is not null))[1],
    array_agg(distinct r.source),
    array_agg(distinct r.sentiment),
    count(*)::int,
    min(r.received_at),
    max(r.received_at),
    bool_or(r.sentiment in ('interested','not_interested','not_now','referral')),
    -- Worth a follow-up, which is what every "Interested" tile is really
    -- asking. `labels` carries the exact word alongside, so a row that is here
    -- because of a referral still says so on the screen.
    bool_or(r.sentiment in ('interested','referral','not_now')),
    bool_and(r.sentiment = 'unclassified'),
    bool_and(r.sentiment = 'auto_reply')
  from replies r
  where r.lead_email is not null
    and (p_source    is null or r.source = p_source)
    and (p_campaigns is null or r.campaign_id = any (p_campaigns))
    and (p_from is null or r.received_at >=  (p_from::timestamp      at time zone 'America/New_York'))
    and (p_to   is null or r.received_at <  ((p_to + 1)::timestamp   at time zone 'America/New_York'))
  group by lower(r.lead_email)
$function$;

-- ---------------------------------------------------------------- the rules

-- A handover is a referral, not interest. Same phrases, different word, and
-- the word is the whole of what decides whether HubSpot hears about it.
update public.reply_rules
   set sentiment = 'referral',
       note      = 'Hands us to a named colleague — chase the person named, no deal yet',
       pattern   = '(is the best person|best person to|pass this on|reach out to \w|no longer (at|run|with) \w|i (do not|don.t) handle|not the right person, |direct (any )?(future )?(inquir|enquir)|forward(ing|ed)? (this|your (e-?mail|message)) to)'
 where priority = 100;

-- Priority 66: after every refusal, before the interest patterns.
--
-- Deliberately last among the noes. "We don't need these services at the
-- moment but will keep you in mind" is a real row in this table, and the
-- refusal in its first half is the more reliable half — a soft door left open
-- at the end does not undo it. An explicit no still wins, and this catches
-- only the replies that postpone without refusing.
insert into public.reply_rules (priority, sentiment, field, pattern, note, enabled)
values (
  66, 'not_now', 'body',
  '(not (a good|the right) time|now is not|not right now|circle back|check back|(reach|get) (back )?(out|in touch) (again )?(in|next|later|after)|revisit|later in the (year|season|summer)|next (year|quarter|season|spring|summer|month)|busy season|after (the )?(summer|season|winter|holidays)|not currently looking|keep (you|your info|us) (posted|in mind)|keep (you|it|this) in mind)',
  'Postpones without refusing — chase later, no deal yet',
  true
)
on conflict do nothing;

-- The three referrals already on file, relabelled by hand on 14 Sep 2026:
-- Mike McCann (Colleen), John Forester (Jason Kilgo), Jennifer
-- Berthelot-Jelovic (BranchPattern). Done through classify_reply so they carry
-- classified_by='human' and no later rule edit can assert over them.
