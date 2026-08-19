-- ============================================================
-- The eleven Instantly replies nobody could read until today.
--
-- These sat `unclassified` because the only text on file was the first 60
-- characters of each. The sync now stores the whole message, the backfill
-- repaired the ones already here, and eleven of the thirteen say plainly what
-- they are. Read and labelled 19 Aug 2026.
--
-- `classified_by` is 'ai', not 'human', and that is deliberate. No person has
-- read these. Marking them 'human' would be the one lie this table is built to
-- prevent — v_reply_conflicts counts `confirmed` as classified_by = 'human' to
-- mean "someone settled this", and that count has to keep meaning it. They show
-- on /replies under their label with the buttons still live, so confirming or
-- overturning any of them is one click.
--
-- ---------------------------------------------------------------------------
-- Four were robots the subject-line heuristic let through, and each names the
-- reason it did:
--
--   Emeline Lalonde  — maternity leave. Subject "(autoresponse) ...", which
--                      AUTO_SUBJECT does not match; the body says "maternity
--                      leave" and AUTO_BODY needs the whole word, which the
--                      60-character cut had removed. Both halves failed on the
--                      same message.
--   Lavina Rego      — "out of office on vacation", subject "Re: Follow Up".
--   Michael Lock     — "I have retired as October 27th, 2022."
--   Jeff Hohenstein  — "For assistance please contact:" and four names.
--
-- The last three keep a "Re:" subject, and looksAutomatic() returns false on
-- sight of one before it ever reads the body. That short-circuit is left alone
-- on purpose: it can only ever miss a robot, and a missed robot surfaces in the
-- unread queue where a person catches it. Loosening it risks the opposite —
-- filing a real reply as automatic, which removes a human from the response
-- rate silently, with nothing on any screen to prompt a second look.
--
-- ---------------------------------------------------------------------------
-- Six declined. Two said "not interested" in those words; the rest are the same
-- answer with a reason attached — wrong fit ("we work as a subtrade for the
-- roofers"), already served ("we have our own drone for thermal imaging"), or
-- an unsubscribe. Julie Wojciechowski's "not interested at this time" is read
-- as a refusal rather than `not_now`: she is closing the conversation, not
-- asking to be found again later.
--
-- One is a live opportunity. Aurelien Leblay: "Before we schedule a meeting, I
-- have a few quick questions — where are you based, what are your rates for a
-- 100,000 sq ft building, what is the timeframe?" That is the only unread
-- Instantly reply that was worth reading, and it had been sitting behind
-- "Hi Mark,  Thank you for reaching out. Before we schedule a m".
--
-- ---------------------------------------------------------------------------
-- Bharat Mudgal's two replies (29 Jul, 4 Aug) are NOT here. Migration
-- 20260818205745 left them unclassified deliberately: both are quoted-header
-- fragments of the one thread whose 28 Jul message is already `interested`, and
-- positive_replies counts reply rows, so labelling them would count a single
-- conversation three times. That reasoning still holds and is not being
-- reversed here.
-- ============================================================

update replies r
   set sentiment     = v.sentiment,
       classified_by = 'ai',
       classified_at = now()
  from (values
    ('6d872ab8-f1af-414b-9dc7-b8956fb6a4d6'::uuid, 'interested'),      -- Aurelien Leblay
    ('554b5299-9428-48c5-a9ba-7307f18f1bf2'::uuid, 'not_interested'),  -- Jeff Bowman
    ('6c1efc8a-bd4a-4a6e-819c-3a3dc24d467d'::uuid, 'not_interested'),  -- Christie Nahrgang
    ('8b3973c9-f914-4967-be73-32795f6fc530'::uuid, 'auto_reply'),      -- Emeline Lalonde
    ('64f5c0a7-a694-4a33-bd0f-2959b2580e6c'::uuid, 'auto_reply'),      -- Lavina Rego
    ('f306d536-993f-442e-bac5-de9618731cab'::uuid, 'not_interested'),  -- Mark Mollison
    ('16ab2e44-1e6b-41da-9225-f66bc79fd9d0'::uuid, 'auto_reply'),      -- Michael Lock
    ('57e96b03-e352-4c99-9180-43bf24da0583'::uuid, 'not_interested'),  -- Julie Wojciechowski
    ('86469de5-6395-41a0-8df9-1eb1a8729fff'::uuid, 'not_interested'),  -- Reginald McCarthy
    ('15d9f997-ba14-4553-81ea-12df3ed4bab9'::uuid, 'not_interested'),  -- Peter Sjouwerman
    ('dddbc553-2c87-4034-90b6-41dc1b9740cc'::uuid, 'auto_reply')       -- Jeffrey Hohenstein
  ) as v(id, sentiment)
 -- Only where still unread. If someone labelled one of these between the read
 -- and this migration, the person wins.
 where r.id = v.id
   and r.sentiment = 'unclassified';
