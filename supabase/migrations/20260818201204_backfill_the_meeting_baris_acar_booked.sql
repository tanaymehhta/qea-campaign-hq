-- The meeting the headline KPI has been missing since 4 August.
--
-- Mark Vasu logged a call with Baris Acar at 17:40 on 4 August with outcome
-- `booked_meeting` — "interested in demo, setting up Teams call". The code that
-- turns a booked call into a meetings row was added on **6 August**, two days
-- later, and was never backfilled. So "Meetings booked", the number this company
-- steers on, has read one short ever since.
--
-- Inserted with the same link the live path now writes, so it is
-- indistinguishable from one logged today: `source_call_id` pointing at the
-- call, `origin = 'call'`. If that call is later edited away from
-- booked_meeting or deleted, this meeting now cancels itself.
--
-- ---------------------------------------------------------------------------
-- **Bashkim Caci is deliberately not here**, and this is the correction TRUST.md
-- needs. It counts six meetings and names Bashkim as the second missing one.
-- Read from the live table: that call was logged 4 Aug 17:52 and
-- **soft-deleted at 19:00 the same evening**. Its note is "x105 left voicemail"
-- — the booked_meeting tick was the stray-click bug in OUTCOME_PRIORITY, and
-- somebody withdrew it within the hour. Inserting it would restore a mistake
-- that was already correctly undone.
--
-- The real count is five rows across four people, not six.
--
-- ---------------------------------------------------------------------------
-- The two Jeffrey Hohenstein rows stay. Both were written in one insert,
-- created_at identical to the microsecond, with notes reading "First of two
-- meetings" and "Second of two meetings, confirmed by Tanay in chat 30 Jul".
-- Two meetings genuinely happened. Decided 18 Aug: the tile says "Meetings
-- booked" and counts meetings, so it counts both. Recorded here so it stops
-- being re-asked.
insert into meetings (prospect_name, prospect_email, company, meeting_date,
                      status, evidence, logged_by, note, source_call_id, origin)
select pc.prospect_name,
       lower(ct.email),
       ct.org_name,
       pc.call_date,
       'booked',
       'chat',
       pc.rep,
       'Backfilled 18 Aug. The call was logged 4 Aug, two days before log_call '
       'began writing meetings rows, so this never reached the KPI. '
       'Rep note: ' || coalesce(pc.note, '—'),
       pc.id,
       'call'
from phone_calls pc
left join call_contacts ct on ct.id = pc.contact_id
where pc.id = 'c7e3c9f1-dd35-4339-a066-3004e8cbdcb4'
  and pc.deleted_at is null
  and not exists (select 1 from meetings m where m.source_call_id = pc.id);
