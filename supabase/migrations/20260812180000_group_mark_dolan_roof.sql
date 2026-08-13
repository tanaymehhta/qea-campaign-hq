-- Mark Dolan's roof campaign: give it a group, an owner, and the five other
-- hand-kept fields the sync never writes.
--
-- Launched in Instantly on 11 Aug as "Roof Campaign - Mark Dolan". The sync
-- found it on its own and by 13 Aug held 809 leads, 400 sends, 9 bounces and
-- 6 replies against it. What it could not supply is ownership: Instantly's
-- only ownership-ish field is `organization`, the workspace uuid, identical on
-- every campaign. So the whole of the rep layer — the homepage filter, the
-- /calls roster, the avatar — was blind to it.
--
-- The name uses a plain hyphen, not an em dash, so regroup() filed it under
-- Ungrouped: owner null, status 'abandoned', sharing a card with the errored
-- AI SDR shadow campaign, and tripping the status-drift canary on /health the
-- moment it started sending.

-- ---------------------------------------------------------------- the group
--
-- sequence_shape is read off the five rows already in template_versions
-- (delays 0/4/5/6/7, each the wait *before* its step), accumulated the same
-- way Chicago Retrofit's string was: E1 d0 · E2 +7 · E3 +14 · E4 +15 comes
-- from delays 7/7/7/1. list_source is left null on purpose — where this list
-- came from is not recorded anywhere I can read, and a guess on that line is
-- worse than a dash.
insert into campaign_groups
  (slug, display_name, owner, platform, geography, segment, sequence_shape,
   description, status, started_on, sort_order)
values
  ('roof-campaign-mark-dolan',
   'Roof Campaign — Mark Dolan',
   'Mark Dolan',
   array['instantly'],
   'Canada',
   'Roofing contractors & consultants',
   'E1 d0 · E2 +4 · E3 +9 · E4 +15 · E5 +22',
   'Canadian roofing contractors and roof consultants — Quebec, Ontario, the '
   'prairies. Ten mailboxes across qeatechbuild / qeatechaudit / qeatechretrofit, '
   '350 a day, open tracking off.',
   'live',
   '2026-08-11',
   50)
on conflict (slug) do nothing;

-- ----------------------------------------------------------- the membership
--
-- 'override', not 'auto': regroup() skips every campaign carrying an override,
-- so this survives the next sync and every sync after it. Without that flag the
-- half-hourly run would read the hyphen in the vendor's name and put the
-- campaign straight back into Ungrouped.
insert into campaign_group_members
  (group_id, campaign_id, sub_campaign_label, assignment_source)
select g.id, c.id, 'Roof Campaign', 'override'
from campaign_groups g, campaigns c
where g.slug = 'roof-campaign-mark-dolan'
  and c.source = 'instantly'
  and c.source_campaign_id = 'a998347d-2444-4131-9d35-29f3ab82552e'
on conflict (campaign_id) do update
  set group_id           = excluded.group_id,
      sub_campaign_label = excluded.sub_campaign_label,
      assignment_source  = excluded.assignment_source;

-- Ungrouped is left holding only the errored, zero-send AI SDR campaign, which
-- takes it back off v_group_status_drift without touching its stored status.

-- --------------------------------------------------------------- the two Marks
--
-- campaign_groups said 'Mark' and call_campaigns said 'Mark Vasu', and
-- callsRoster() unions the two, so /calls has been listing one person twice.
-- Adding a second real Mark makes that ambiguity a genuine misread. owner is a
-- plain text column referenced by no foreign key — the only cost is that an
-- old ?rep=Mark link stops matching.
update campaign_groups set owner = 'Mark Vasu' where owner = 'Mark';

-- ------------------------------------------------------------ the mailboxes
--
-- These ten were hand-seeded as source='standby' on 6 Aug, before the campaign
-- existed. The 03:00 ET run on 12 Aug pulled the same addresses from Instantly,
-- and the unique key is (source, email), so each mailbox now has two rows and
-- /inboxes draws it twice. The standby row is the empty one — null warmup
-- score, null daily limit — so the live row is the one to keep.
delete from email_accounts a
where a.source = 'standby'
  and exists (
    select 1 from email_accounts b
    where b.source <> 'standby' and lower(b.email) = lower(a.email)
  );
