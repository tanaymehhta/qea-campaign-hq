-- Say which of the two signals actually failed.
--
-- The previous wording asserted "has not sent in over a fortnight" for every
-- row, and the only row it produces says otherwise: `qea` last sent 4 days ago.
-- It reads `ended` because it has **zero campaigns running** - nothing further
-- can go out - not because it went quiet. A canary that misreports the reason
-- sends someone to check the wrong thing.
create or replace view v_group_status_drift as
select g.id, g.slug, g.display_name,
       g.status        as stored_status,
       v.actual_status,
       v.running_count, v.campaign_count, v.first_sent_on, v.last_sent_on, v.sent,
       case
         when v.actual_status = 'live' then
           format('labelled %s, but %s campaign%s running and it sent %s days ago',
                  g.status, v.running_count, case when v.running_count = 1 then ' is' else 's are' end,
                  current_date - v.last_sent_on)
         when v.running_count = 0 and v.last_sent_on < current_date - 14 then
           format('labelled %s, but nothing is running and it last sent %s days ago',
                  g.status, current_date - v.last_sent_on)
         when v.running_count = 0 then
           format('labelled %s, but none of its %s campaigns is running any more — nothing further can go out',
                  g.status, v.campaign_count)
         else
           format('labelled %s, but it has not sent in %s days',
                  g.status, current_date - v.last_sent_on)
       end as detail
from campaign_groups g
join v_group_summary v on v.id = g.id
where (g.status in ('live', 'planned')     and v.actual_status = 'ended')
   or (g.status in ('ended', 'abandoned')  and v.actual_status = 'live');

grant select on v_group_status_drift to anon, authenticated;
