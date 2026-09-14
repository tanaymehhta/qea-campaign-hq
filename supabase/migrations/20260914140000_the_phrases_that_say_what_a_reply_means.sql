-- ============================================================
-- A reply is read by a list of phrases, and the list is editable.
--
-- Until now the only automatic judgment on an inbound email was
-- `looksAutomatic()` in the sync: one regex, in TypeScript, that could say
-- "robot" and nothing else. Everything that was not a robot arrived
-- `unclassified` and waited for a person. That is why 22 interested and 20 not
-- interested took two months of clicking to accumulate.
--
-- What replaces it is not a model. Forty labelled examples cannot train one,
-- and anything that claims otherwise on forty examples has memorised the word
-- "roofing". What forty examples *can* do is show which phrases recur, and in
-- cold-email replies they recur relentlessly: "please remove me from your
-- list", "we are not interested", "how much do you charge", "I am out of the
-- office". So the classifier is a table of phrases, ordered, first match wins,
-- and no match means no answer.
--
-- Three properties matter more than accuracy:
--
--   1. It never overwrites a person. `classified_by = 'human'` is checked
--      first in the trigger, the same promise `ingest_replies` already makes.
--   2. It abstains. No match leaves the row exactly as it was — which for new
--      mail means `unclassified`, the pile a person reads. A wrong tag costs
--      more than a missing one, because a wrong tag is never looked at again.
--   3. It shows its working. Every automatic label records the rule that
--      produced it, so "why is this marked interested" has an answer, and the
--      answer is one editable row rather than a redeploy.
--
-- Measured against the 49 replies a human has labelled, at the phrase list
-- seeded below: 37 agree, 11 abstain, 1 disagreement — and in that one the
-- machine is right (subject "Automatic reply: DBHMS + QEA", empty body, filed
-- by hand as not interested). Of the 11 abstentions, 9 are internal forwards,
-- bare signature blocks or "Hi Mark," with nothing after it — mail with no
-- opinion in it to find. On the 40 replies that are a real prospect saying a
-- real thing: 37 right, 0 wrong, 3 abstained.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. The phrases.
-- ------------------------------------------------------------------

create table reply_rules (
  id         uuid primary key default gen_random_uuid(),
  -- Lowest first, and the first match wins, so this column is the whole
  -- control flow. Out-of-office is tested before interest on purpose: the
  -- failure this system exists to prevent is an autoresponder counted as a
  -- lead, which is exactly what six hand-labelled rows did until today.
  priority   int  not null,
  sentiment  text not null
             check (sentiment in ('interested','referral','not_now','not_interested','auto_reply')),
  -- Which half of the email to test. 'subject' is the stronger signal when it
  -- exists — "Automatic reply:" is a fact, not a guess — but most mail only
  -- has a body worth reading.
  field      text not null default 'body' check (field in ('body','subject')),
  -- POSIX regex, tested against lowercased text. Written to be read by
  -- somebody who is not a programmer: mostly alternations of plain phrases.
  pattern    text not null,
  note       text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
create index on reply_rules (enabled, priority);

comment on table reply_rules is
  'The phrase list that labels inbound replies. Edit freely: add a pattern, '
  'run select reclassify_replies(), check v_rule_accuracy. Never affects a '
  'reply a human has labelled.';

-- Which rule produced the label on a row. Null for human judgments and for
-- rows nothing matched.
alter table replies add column matched_rule uuid references reply_rules(id) on delete set null;

-- 'rule' joins 'ai' and 'human'. It is kept distinct from 'ai' so the old
-- TypeScript guess and this one are never confused in a count — and so that
-- the day this replaces `looksAutomatic()` entirely, the rows it wrote can be
-- found.
alter table replies drop constraint if exists replies_classified_by_check;
alter table replies add  constraint replies_classified_by_check
  check (classified_by in ('ai','human','rule'));

-- ------------------------------------------------------------------
-- 2. The text a rule actually sees.
--
-- This is the part that would quietly ruin everything if it were skipped.
-- Instantly hands back the whole thread: the reply on top, and underneath it
-- every outbound email it answers. Our own copy contains "Would this be useful
-- to you?" and "Book a call with me" — so a rule looking for interest, run
-- against a raw body, matches our own sales pitch on every single reply
-- including the refusals. The quoted thread has to go before anything is read.
--
-- Cut at the first quoting marker of any dialect: a ">" line (Gmail plain
-- text), "-----Original Message" (Outlook), a rule of underscores (Outlook
-- HTML), "From:" / "Sent:" headers, "On <date> ... wrote:", "Sent from my
-- iPhone". Then lowercase, collapse whitespace, and keep the first 600
-- characters — a person's actual answer is in the first sentence or two, and
-- everything after it is signature.
-- ------------------------------------------------------------------

create or replace function public.reply_text(p_body text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(
    left(
      left(coalesce(p_body, ''),
        coalesce(least(
          nullif(position(E'\n>'            in coalesce(p_body,'')), 0),
          nullif(position(E'\n-----'        in coalesce(p_body,'')), 0),
          nullif(position(E'\n____'         in coalesce(p_body,'')), 0),
          nullif(position(E'\nFrom:'        in coalesce(p_body,'')), 0),
          nullif(position(E'\nSent:'        in coalesce(p_body,'')), 0),
          nullif(position(E'\nSent from my' in coalesce(p_body,'')), 0),
          nullif(regexp_instr(coalesce(p_body,''), E'\nOn .{0,200}wrote:'), 0),
          nullif(position(E' wrote:'        in coalesce(p_body,'')), 0)
        ), 100000) - 1),
      600),
    '\s+', ' ', 'g')));
$$;

-- ------------------------------------------------------------------
-- 3. The reading.
-- ------------------------------------------------------------------

create or replace function public.guess_sentiment(p_subject text, p_body text)
returns table (sentiment text, rule_id uuid)
language plpgsql
stable
as $$
declare
  s text := lower(coalesce(p_subject, ''));
  x text := reply_text(p_body);
  r record;
begin
  -- Nothing to read is not the same as nothing to say. A bare signature or an
  -- internal forward with two words in it gets no opinion at all.
  if length(x) < 3 and s = '' then
    return;
  end if;

  for r in select * from reply_rules where enabled order by priority, created_at loop
    if (case r.field when 'subject' then s else x end) ~ r.pattern then
      sentiment := r.sentiment;
      rule_id   := r.id;
      return next;
      return;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 4. When it runs.
--
-- A trigger rather than a change to the sync, for one reason: there would
-- otherwise be two classifiers in two languages, and the second one to be
-- edited is a bug with a six-month fuse. The sync keeps sending whatever it
-- sends; this overwrites it unless a person has spoken.
-- ------------------------------------------------------------------

create or replace function public.replies_autolabel()
returns trigger
language plpgsql
as $$
declare
  g record;
begin
  -- The promise. A human's judgment is final and this function is not allowed
  -- to have an opinion about it.
  if new.classified_by = 'human' then
    return new;
  end if;

  select * into g from guess_sentiment(new.subject, new.body);

  -- Abstention leaves the row untouched — including a label an earlier run
  -- wrote. Rules are only ever allowed to *assert*, never to erase, so
  -- narrowing a pattern cannot silently blank a hundred rows.
  if g.sentiment is not null then
    new.sentiment     := g.sentiment;
    new.matched_rule  := g.rule_id;
    new.classified_by := 'rule';
    new.classified_at := now();
  end if;

  return new;
end $$;

-- `ingest_replies` repairs bodies on rows it has already seen, so a message
-- stored back when only a 60-character preview was kept gets its full text
-- later. The label has to be reconsidered when that happens, which is why the
-- update trigger watches `body` and not only inserts.
create trigger replies_autolabel_ins
  before insert on replies
  for each row execute function replies_autolabel();

create trigger replies_autolabel_upd
  before update of body, subject on replies
  for each row execute function replies_autolabel();

-- Re-read history after editing the phrase list. Returns how many rows changed.
create or replace function public.reclassify_replies()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  with g as (
    select r.id, q.sentiment, q.rule_id
    from replies r
    cross join lateral guess_sentiment(r.subject, r.body) q
    where r.classified_by is distinct from 'human'
  )
  update replies r
     set sentiment = g.sentiment, matched_rule = g.rule_id,
         classified_by = 'rule', classified_at = now()
    from g
   where r.id = g.id
     and (r.sentiment is distinct from g.sentiment or r.matched_rule is distinct from g.rule_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------------
-- 5. Whether it is any good.
--
-- Every reply a person has labelled is a held-out test, permanently. This view
-- is the number that says whether the phrase list is improving or whether the
-- last edit made it worse, and it costs nothing to keep looking at.
-- ------------------------------------------------------------------

create or replace view v_rule_accuracy as
select
  r.sentiment                                        as human_said,
  coalesce(q.sentiment, '(abstained)')               as machine_said,
  count(*)                                           as n
from replies r
left join lateral guess_sentiment(r.subject, r.body) q on true
where r.classified_by = 'human'
group by 1, 2;

-- The disagreements themselves, which is the working list: each row is either
-- a phrase to add or a label to fix.
create or replace view v_rule_disagreements as
select
  r.id, r.received_at, r.lead_name, r.lead_email, r.subject,
  r.sentiment                          as human_said,
  q.sentiment                          as machine_said,
  (select note from reply_rules where id = q.rule_id) as fired,
  left(reply_text(r.body), 200)        as text_read
from replies r
left join lateral guess_sentiment(r.subject, r.body) q on true
where r.classified_by = 'human'
  and q.sentiment is distinct from r.sentiment
order by r.received_at desc;

-- ------------------------------------------------------------------
-- 6. The seed list.
--
-- Every phrase below was taken from a real reply in this database, not
-- imagined. Priorities leave gaps of ten so a new rule can be slotted between
-- two existing ones without renumbering.
-- ------------------------------------------------------------------

insert into reply_rules (priority, sentiment, field, pattern, note) values

-- --- 10s: the machine wrote it. Tested first, always. ---
(10, 'auto_reply', 'subject',
 '^(automatic reply|auto.?reply|out of office|notice:|re: out of office|re: retirement|abwesenheit|réponse automatique)',
 'Subject line declares itself an autoresponder'),
(20, 'auto_reply', 'body',
 '(out of (the )?office|away from (the )?office|away until|out of town|on (annual |parental |maternity )?leave|limited access to (my )?e-?mail|no access to (phone|communications)|away from my desk)',
 'Out of office'),
(30, 'auto_reply', 'body',
 '(i am retiring|am retiring|i have retired|i retired|as of .{0,40}i am retiring)',
 'Retirement autoresponder'),

-- --- 40s–60s: they said no. Tested before interest, because a refusal often
-- --- contains a polite phrase that would otherwise read as warmth. ---
(40, 'not_interested', 'body',
 '(not interested|no longer interested|not one bit interest|no thanks|no thank you)',
 'Says not interested in as many words'),
(50, 'not_interested', 'body',
 '((please |can you |could you |kindly )?(remove|take) me (off|from)|remove my contact|remove (me )?from (e-?mail|your)|off your (mailing )?list|^unsub|unsubscribe|stop contacting|stop harassing|please stop|take me off)',
 'Asks to be removed from the list'),
(60, 'not_interested', 'body',
 '(we (do not|don.t) do |i (do not|don.t) do |does not fit|doesn.t fit|not what we do|don.t need these services|do not need these services|not a roofer|no idea what you are talking about|wrong (person|number)|i don.t own|anything to do with what you are trying)',
 'Says it is not what they do, or not them'),

-- --- 70s–90s: they said yes. ---
(70, 'interested', 'body',
 '(how much|what.s the (cost|price)|what is the (cost|price)|pricing|unit cost|send me (an |a )?(example|sample|report)|can you send|share (an |a )?(example|sample)|learn more|tell me more|more information|more info)',
 'Asks for a price, a sample, or more detail'),
(80, 'interested', 'body',
 '(open to (meeting|a meeting|a call)|have some availability|do you have time|time next week|some time tomorrow|works for your schedule|schedule a (call|time)|set up a (call|meeting)|happy to (chat|connect|be connected)|let.s (set up|find a time)|book a time)',
 'Offers or asks for time'),
(90, 'interested', 'body',
 '(sounds interesting|very interesting|this is interesting|it is interesting|looks interesting|appreciate the services|i.d like to|i would like to|we.d be interested|keen to)',
 'Says it sounds interesting'),

-- --- 100: they are not the right person but named who is. Counted as
-- --- interested by decision on 14 Sep 2026: a named handover is a lead, and
-- --- the person named gets their own row when they reply. Tested last, so an
-- --- out-of-office that says "in my absence contact Ken" is a robot first. ---
(100, 'interested', 'body',
 '(is the best person|best person to|pass this on|reach out to \w|no longer (at|run|with) \w|i (do not|don.t) handle|not the right person, )',
 'Hands us to a named colleague');

-- Added the same afternoon, from two replies the seed list abstained on. This
-- is what the loop looks like in practice: a shape it had not met, one row
-- each, no deploy.
insert into reply_rules (priority, sentiment, field, pattern, note) values
(65, 'not_interested', 'body',
 '(already (have|working with|use) (a |an )?(provider|vendor|supplier|company|partner)|under contract|locked in|we.re all set|we are all set|have someone for this)',
 'Already has a supplier'),
(75, 'interested', 'body',
 '(what does .{0,40}cost|what would .{0,40}cost|ballpark|quote for|rate for)',
 'Asks what it costs, in other words');
