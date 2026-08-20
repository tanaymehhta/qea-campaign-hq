-- ============================================================
-- The lemlist inbox, read by a human, two days before it is switched off.
--
-- 135 replies were on file. 111 of them had no body stored at all and 109 of
-- those had been filed as `auto_reply` by a regex on the subject line, because
-- lemlist's /activities feed only ever handed the sync a `messagePreview` —
-- usually the greeting and no more. "Mark," was the whole of what we held for a
-- man who had written "I am definitely interested, though."
--
-- The bodies were pulled from lemlist's inbox API on 20 Aug 2026, the join key
-- being the activity id, which is already this table's `source_message_id`.
-- Nothing here was matched by guesswork. The subscription ends this week, so
-- this is the last day the text could be recovered at all — after it, these
-- rows would have stayed fragments permanently.
--
-- Tanay then read all 135 in one sitting and labelled every one. His decisions
-- are section 2, applied as `classified_by = 'human'` because they are his
-- judgments. Section 1 is the vendor's own text and is applied first, so the
-- record shows what was read before it shows what was concluded.
--
-- ---------------------------------------------------------------------------
-- Deliberately NOT lemlist's AI
--
-- Each reply carries `aiLeadInterest` / `aiLeadInterestLevel`, and using it as a
-- pre-tag was the obvious shortcut. It was tested and rejected on the evidence.
--
-- Douglas Lee's thread holds two rows. The first is his real reply, "No idea
-- what you are talking about. Please remove from email", scored negative 0/6 —
-- correct. The second, act_omRZzjg3hxJcvfB7C, is **Mark Vasu's own forward to a
-- colleague**, which lemlist filed as an inbound reply and scored
-- **positive, 4 of 6**. Trusting that field would have invented an interested
-- prospect out of our own outbound mail — a fresh instance of exactly the fault
-- the 18 August review exists to end. It is labelled `auto_reply` below so it
-- stays out of the response count, and the AI score is written nowhere.
--
-- What the human pass found that the machine had not:
--   * Scott Farbman was filed a robot by the subject-line regex. His message is
--     "Not interested." — a refusal, and a refusal is a response.
--   * Younes Amermouch and Sherry Chen (Johnson Fain) had both offered meeting
--     times. Both sat at `unclassified`, in no metric on the dashboard.
--   * Jon Weir, Sri Sukhi, Adam Atkinson and Keith Gipson had all written back
--     at length and were being counted as nothing.
--
-- ---------------------------------------------------------------------------
-- The vocabulary shrinks to three
--
-- Tanay's answer set is Interested / Not interested / Automatic. `referral` and
-- `not_now` are not used by a single row in this table (measured 20 Aug 2026),
-- so nothing is being discarded — the two referrals found here, Jennifer
-- Berthelot-Jelovic passing us to BranchPattern and John Forester naming Jason
-- Kilgo, are recorded as `interested` because that is where he put them.
-- `unclassified` survives as the state of mail nobody has read yet. It is not a
-- button and never was an answer.
--
-- Total responses is now interested + not_interested, and nothing else.
--
-- ---------------------------------------------------------------------------
-- Effect, both vendors, all time
--
--   Total responses   9 -> 31
--   Interested        3 -> 15
--   Not interested    6 -> 16
--   Needing a label  21 -> 0
--
-- No new table. No stored count. The tiles still count these rows live through
-- `response_counts`, exactly as they did an hour ago.
-- ============================================================

-- 12 bodies rescued, 26 labels set by hand.

-- ---------- 1. the messages themselves ----------
update replies set body = 'Hi Mark,

Would the unit cost work for a Best Western / Hampton Inn?  That''s our market.

Regards,
Sri' where source_message_id = 'act_LPHnbKtppmMFTvPDm' and source = 'lemlist';
update replies set body = 'Mark,

I appreciate your taking the time to send the information on your firm. It is interesting and in line with the work with drone companies that I have worked with before. As you can surmise, there are a few things that are not quite as important here in Southern California such as IR imaging and other, cold weather issues.

Your firm looks quite capable and I would appreciate if you could send over information that I can review and refer to as these projects arise. I have found a few companies here in SoCal but they seem to be more interested in making substantially more money than a project requires by ignoring the immediate needs and promising to provide reports and studies that are not necessary. Hopefully your firm can scale as necessary to meet job requirements.

We can discuss issues at a later date as I am a bit busy with some other items at the moment. I am definitely interested, though.

Best,
Jon' where source_message_id = 'act_8cwjLdv7M4oo2YnHY' and source = 'lemlist';
update replies set body = 'Mark,

This sounds interesting. I''d like to learn more. I don''t decide who orders these types of reports though, since I''m on the sale side for the manufacturer. As long as you understand my role, we can discuss this further.

Adam Atkinson
541-480-0402
adam.atkinson@gaf.com
11800 Industry Dr.
Fontana, CA 92337' where source_message_id = 'act_cZomzXEuMFw2LAcJG' and source = 'lemlist';
update replies set body = 'Hi Mark

Our AI agents are specific to the control and supervisory process for HVAC equipment.

Closed loop control.

Our business model is Software as a Service (SaaS) connected to our Azure Cloud using our own proprietary (software, never hardware) gateways direct to the existing Building Automation or PLC SCADA control system.

Thanks

Keith' where source_message_id = 'act_xoHEpNr5p3bsfh98Q' and source = 'lemlist';
update replies set body = 'Mark,

I no longer run ASAP, as I moved over to BranchPattern full-time a year ago.
I can pass this on to the BranchPattern team and see if anyone is interested in learning more or attending a webinar.

Best,
Jen' where source_message_id = 'act_FN3JRvuA2rzpnKpg4' and source = 'lemlist';
update replies set body = 'Hi Mark, Thanks for reaching out. I''m no longer at RMR. For Sonesta, you might want to try to reach out to Jason Kilgo. Enjoy your holiday. John' where source_message_id = 'act_yDtgRYEWBD5x7gtMe' and source = 'lemlist';
update replies set body = 'Mark,

This does not fit with what we do.  Additionally, the company you call out is one that I worked at several years ago.

Best Regards,
Jim

Jim Dunne, P.E.
312-404-7515 | jim@alignegy.com' where source_message_id = 'act_GzSdzJc77TWcJLkB7' and source = 'lemlist';
update replies set body = 'Mark,

This would be good for contractors, but as far as for us, these decisions would be made at a corp. level.  I am not sure whom that would be.
Apologies.  Good luck.

Randy Burris
Area Manager Southern California
Randy.Burris@Amrize.com
M: (805) 908-7572' where source_message_id = 'act_w7vsWJ3FdZfDYgW8w' and source = 'lemlist';
update replies set body = 'No idea what you are talking about.  Please remove from email
Thanks

Sent from my T-Mobile 5G Device' where source_message_id = 'act_Q8LBCZffQdb5Ynhbp' and source = 'lemlist';
update replies set body = 'Please help. Let''s also review messaging.

Best,

Mark Vasu
Vice President, Business Development US | QEA Tech Inc.
444 Somerville Ave, Somerville, Massachusetts 02143' where source_message_id = 'act_omRZzjg3hxJcvfB7C' and source = 'lemlist';
update replies set body = 'Thank you Mark, very interesting technology and application.' where source_message_id = 'act_cMqYu6m3qAJ9brwfS' and source = 'lemlist';
update replies set body = 'Hi Mark - Happy to be connected here. Thanks for reaching out.' where source_message_id = 'act_Yc3WrG8hsdW2L8vzD' and source = 'lemlist';

-- ---------- 2. what Tanay decided each one means ----------
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '5e24bb18-1d15-44e8-b02d-454aebcc1b2c';  -- Bharat Mudgal: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '7b548c03-d788-4e2e-9f44-4c5031142e89';  -- Galen Williams: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '083d6c8b-fe23-43f4-aa4b-5ebf524fb896';  -- Mark Attard: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '241b11db-f6f2-46bb-92c4-eaf02b6e5a56';  -- Ben Myers: unclassified -> interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '6bd0e137-1ca0-4f29-b9ed-3f750dde5d45';  -- Randy Burris: unclassified -> not_interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '1efe2ae8-de53-4d36-95d9-7009a3fe2c37';  -- Mark Anderson: unclassified -> not_interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = 'aaf17488-6bd4-4d20-95aa-2e3750140e0e';  -- Jim (Shay) Dunne: unclassified -> not_interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '8e7f74ba-6059-478d-ad79-11f8750a5e67';  -- Billy Peltier: unclassified -> not_interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '4c5710fd-0861-4987-8f7f-21e20c71835c';  -- John Polich: unclassified -> not_interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = 'f7998e80-18e3-4b15-a219-f16188180f43';  -- Adam Atkinson: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '0b3aadd5-76c3-4a31-8178-b4d17df8ce96';  -- Sri Sukhi: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = 'c4e79fe4-7f46-49b8-b55f-2448a7604569';  -- Jon Weir: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = 'f3d518a4-1983-4ee6-8462-ffcda688b2bd';  -- Hardik Miyani: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '21d4f693-5c9d-4998-ba60-5fec9394ec16';  -- Hardik Miyani: unclassified -> interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '27b9e1c7-f42d-4822-bf86-dc0de1f42a2d';  -- Scott Farbman: unclassified -> not_interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '023c5bff-63b5-48c8-9d2c-9392000695bd';  -- Keith Gipson: unclassified -> interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = 'bf8d16f5-4712-4421-b24a-ad14b2e26e91';  -- Michelle Grout: unclassified -> not_interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '20b3b2b5-c68e-4cd1-8387-8bb29e615faa';  -- Michelle Grout: unclassified -> not_interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = 'b22e3b65-8a00-4d6e-9a6f-cb7405359673';  -- Jennifer Berthelot-Jelovic: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '0e64e9d7-21c8-4d17-945b-d90216631df2';  -- Younes Amermouch: unclassified -> interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = 'cd256799-7167-4117-beb6-2660879ca40b';  -- Brendan Townes Bailey: unclassified -> interested
update replies set sentiment = 'auto_reply', classified_by = 'human', classified_at = now() where id = '0e01832d-0807-463c-8bc3-afd69aff7473';  -- Douglas Lee: unclassified -> auto_reply
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = 'ccae8290-8abd-4dce-b0d3-e7b9c34fa90d';  -- Douglas Lee: unclassified -> not_interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '25bec48d-f370-4c9b-a4d8-a4b9d46d2757';  -- Diana Navarrete-Rackauckas: unclassified -> not_interested
update replies set sentiment = 'interested', classified_by = 'human', classified_at = now() where id = '80351526-7ed0-4c3c-9750-49aeb6ebe1be';  -- John T. Forester: unclassified -> interested
update replies set sentiment = 'not_interested', classified_by = 'human', classified_at = now() where id = '10cba3d6-e89a-4f1a-a56d-bb319438904a';  -- Scott Farbman: auto_reply -> not_interested