-- add_lead, checked end to end. Runs against any database built from
-- supabase/migrations and writes nothing: the last statement raises, so the
-- whole DO block rolls back whether it passed or failed. Paste it into the SQL
-- editor — a pass ends with "rollback: ... ok; ok; ..." and no FAIL in it.
do $$
declare g uuid; ok text := '';
begin
  select id into g from campaign_groups order by sort_order limit 1;

  -- The happy path, with a real meeting attached.
  perform add_lead('Zzz Smoketest','zzz.smoketest@example.com','Acme','Head of Nothing','555-0100',
                   g,'assigned','smoketest',true, current_date + 3, current_date, 'calendar','smoke');
  ok := ok || case when (select count(*) from leads
                          where email='zzz.smoketest@example.com' and status='assigned' and phone='555-0100')=1
                   then '1 lead ok; ' else '1 LEAD FAIL; ' end;
  ok := ok || case when (select count(*) from meetings
                          where prospect_email='zzz.smoketest@example.com' and deleted_at is null)=1
                   then '2 meeting ok; ' else '2 MEETING FAIL; ' end;
  -- The one that would have caught the Bharat Mudgal report: a meeting has to
  -- be visible on the lead list, not only on /meetings.
  ok := ok || case when (select meetings from v_lead_people where person_key='zzz.smoketest@example.com')=1
                   then '3 shows on leads ok; ' else '3 LEADS PAGE FAIL; ' end;

  begin perform add_lead('Zzz Again','zzz.smoketest@example.com'); ok := ok || '4 DUPE FAIL; ';
  exception when others then ok := ok || '4 dupe refused ok; '; end;

  begin perform add_lead('Zzz B','zzz.b@example.com', p_status => 'met'); ok := ok || '5 STATUS FAIL; ';
  exception when others then ok := ok || '5 bad status refused ok; '; end;

  begin perform add_lead('Zzz C',''); ok := ok || '6 EMAIL FAIL; ';
  exception when others then ok := ok || '6 no-email refused ok; '; end;

  begin perform add_lead('Zzz D','zzz.d@example.com', p_met => true); ok := ok || '7 DATES FAIL; ';
  exception when others then ok := ok || '7 dateless meeting refused ok; '; end;

  if ok like '%FAIL%' then raise exception 'add_lead smoke FAILED: %', ok; end if;
  raise exception 'rollback: %', ok;
end $$;
