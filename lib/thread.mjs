// One stored reply is the whole thread. Instantly hands over the newest message
// with every earlier one quoted underneath it, and nothing separates them but
// the mail client's own conventions — so the six sends behind a reply live in
// one `replies.body` column and there is no other record of them.
//
// This splits that column back into messages. It is guesswork by nature: the
// only evidence is the text a stranger's mail client produced. When the
// guessing finds nothing, `splitThread` returns a single part holding the body
// unchanged, and the page renders exactly what it rendered before.
//
// .mjs so `node lib/thread.mjs` runs the self-check at the bottom without a
// build step or a package.json flag.

// The two separator shapes on file, measured across all 18 quoted bodies in the
// table on 14 Sept 2026:
//
//   On Tue, Sep 8, 2026 at 8:36 AM Mark Dolan <mark@…> wrote:
//   ---- On Fri, 28 Aug 2026 09:24:57 -0700 Mark Dolan <markd@…> wrote ----
//   ________________________________
//   From: Justin Kim <justin@…>
//   Sent: July 30, 2026 7:33 AM
//
// The first is capped at 240 characters and matched lazily because it wraps
// across lines — the address and the bare word "wrote:" routinely land on the
// next line, and an unbounded [\s\S] would happily swallow the message.
const ON_WROTE = /(?:^|\n)[ \t-]*On\b[\s\S]{0,240}?\bwrote\s*:?[ \t-]*(?=\n|$)/g;
const OUTLOOK = /(?:^|\n)_{5,}[ \t]*\nFrom:[ \t]*(.*)(?:\nSent:[ \t]*(.*))?(?:\n(?:To|Cc|Subject):[ \t]*.*)*/g;

// Hard wrapping happens after the quote markers are added, so a line's own
// depth is a lie: the second line of a depth-2 paragraph carries one ">". Depth
// is therefore never used to group anything — the markers are simply stripped
// and the separators do the splitting.
const unquote = (s) =>
  s.split("\n").map((l) => l.replace(/^[ \t]*(?:[>|][ \t]*)+/, "")).join("\n");

// Undo that same wrapping inside a paragraph: a break mid-sentence was the mail
// client's, not the writer's. A break before a bullet or a blank line was.
const unwrap = (s) =>
  s
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split("\n")
        .reduce((out, line) => {
          const t = line.trim();
          if (!t) return out;
          const prev = out[out.length - 1];
          if (prev && !/^[-*•\d]/.test(t) && !/[-*•]\s*$/.test(prev)) out[out.length - 1] = `${prev} ${t}`;
          else out.push(t);
          return out;
        }, [])
        .join("\n"),
    )
    .join("\n\n")
    .trim();

// The date is pulled out by shape rather than by position, because what sits
// around it differs per client: "Tue, Sep 8, 2026 at 8:36 AM Mark Dolan <…>",
// "Fri, August 28, 2026 4:54 PM, Mark Dolan <…>", "28 Aug 2026 09:24:57 -0700".
// Handing Date.parse the whole line is how "August 28" became 28 March — it
// takes a trailing name as an instruction, silently.
const DATE = /((?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}))(?:[, ]+(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\.?M\.?)?(?:\s*[+-]\d{4})?))?/i;

const whenFrom = (header) => {
  const m = header.replace(/\s+/g, " ").match(DATE);
  if (!m) return { at: null, raw: "" };
  const raw = [m[1], m[2]].filter(Boolean).join(" ");
  const d = new Date(raw);
  return { at: Number.isNaN(+d) ? null : d.toISOString(), raw };
};

// The name is whatever sits immediately before the address, minus the time that
// often runs into it ("8:36 AM Mark Dolan <…>").
const whoFrom = (header) => {
  const flat = header.replace(/\s+/g, " ");
  const email = flat.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase() ?? null;
  const name = flat
    .match(/([^<>\n,]{2,40}?)\s*<[^>]*@/)?.[1]
    ?.replace(/.*\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]\.?M\.?)?/i, "")
    ?.replace(/^(?:On|From:)\s*/i, "")
    .trim();
  return { email, name: name && /[A-Za-z]/.test(name) ? name : null };
};

/**
 * Split a stored body into its messages, oldest first.
 * @param {string} body the `replies.body` column
 * @param {string} leadEmail the person who replied, to tell their side from ours
 * @returns {{from:string|null, email:string|null, at:string|null, when:string, text:string, mine:boolean}[]}
 */
export function splitThread(body, leadEmail = "") {
  const text = unquote(body ?? "");
  const cuts = [];
  for (const re of [ON_WROTE, OUTLOOK]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) cuts.push({ at: m.index, end: m.index + m[0].length, header: m[0] });
  }
  cuts.sort((a, b) => a.at - b.at);

  // A separator inside a separator — Outlook's block sitting under an
  // "On … wrote:" line — would cut a message in half. Keep the outer one.
  const kept = cuts.filter((c, i) => i === 0 || c.at >= cuts[i - 1].end);

  const parts = [];
  let from = 0;
  let header = null;
  for (const c of [...kept, { at: text.length, end: text.length, header: null }]) {
    parts.push({ header, text: unwrap(text.slice(from, c.at)) });
    from = c.end;
    header = c.header;
  }

  const lead = leadEmail.toLowerCase();
  return parts
    .filter((p) => p.text)
    .map((p) => {
      // The first part has no header of its own: it is the message this row
      // *is*, which came from the lead. Every later part is described by the
      // separator that introduced it.
      const who = p.header ? whoFrom(p.header) : { email: lead || null, name: null };
      const when = p.header ? whenFrom(p.header) : { at: null, raw: "" };
      return {
        from: who.name,
        email: who.email,
        at: when.at,
        when: when.raw,
        text: p.text,
        mine: p.header ? who.email !== lead : false,
      };
    })
    .reverse();
}

// ── self-check ───────────────────────────────────────────────────────────────
// The real body of reply 2748409b (Thedy Joseph, Roof Campaign, 10 Sept 2026),
// abridged in the middle but with every separator and every wrap intact.
const SAMPLE = `Hi Mark,

It has been busy , we have some time tomorrow if that works for your
schedule

On Tue, Sep 8, 2026 at 8:36 AM Mark Dolan <mark_dolan@qeatechbuild.com>
wrote:

> Hey Thedy,
>
> If you aren't the right person who handles roof repairs and replacements,
> can you point me to the right person in your company that does?
>
> Mark
>
> On Wed, September 2, 2026 3:53 PM, Mark Dolan <mark_dolan@qeatechbuild.com
> >
> [mark_dolan@qeatechbuild.com]> wrote:
>
> > Hey Thedy,
> >
> > If this is useful but now's not the time, maybe we can find a time later
> in the summer when things quiet down?
> > On Fri, August 28, 2026 4:54 PM, Mark Dolan <mark_dolan@qeatechbuild.com
> >
> > [mark_dolan@qeatechbuild.com]> wrote:
> >
> > > Hey Thedy,
> > >
> > > Figured it might help to show you how this actually works.
> > >
> > > Book a call with me →
> https://meetings.hubspot.com/mark469?uuid=3e2f3579
> > >`;

const OUTLOOK_SAMPLE = `Hi
Thanks for reaching out but we are not interested at this time.

________________________________
From: Justin Kim <justin_kim@qeatech1.com>
Sent: July 30, 2026 7:33 AM
To: Julie Ann WOJCIECHOWSKI <julie.wojciechowski@clearly.ca>
Subject: Re: Clearly + QEA

Julie,

Here is one of our recent projects.`;

function demo() {
  const assert = (ok, what) => {
    if (!ok) throw new Error(`FAILED: ${what}`);
    console.log(`  ok  ${what}`);
  };

  const t = splitThread(SAMPLE, "osedki@excelroofing.ca");
  assert(t.length === 4, `four messages out of one body (got ${t.length})`);
  assert(t[0].text.startsWith("Hey Thedy,"), "oldest first");
  assert(t[3].text.startsWith("Hi Mark,"), "their reply last");
  assert(t.slice(0, 3).every((m) => m.mine), "the three quoted sends are ours");
  assert(!t[3].mine, "the reply is theirs");
  assert(!/[>]/.test(t.map((m) => m.text).join("")), "no quote markers survive");
  assert(
    t[1].text.includes("find a time later in the summer when things quiet down?"),
    "a paragraph wrapped across two quote depths is rejoined",
  );
  assert(t[3].at === null, "the newest part has no header date — the row's own received_at is used");
  assert(t[2].at?.startsWith("2026-09-08"), `date read from the separator (got ${t[2].at})`);
  // "Fri, August 28, 2026 4:54 PM, Mark Dolan <…>" handed to Date.parse whole
  // returns 28 March. This is that regression.
  assert(t[0].at?.startsWith("2026-08-28"), `a name after the date does not move the month (got ${t[0].at})`);
  assert(t[2].from === "Mark Dolan", `name read from the separator (got ${t[2].from})`);

  const o = splitThread(OUTLOOK_SAMPLE, "julie.wojciechowski@clearly.ca");
  assert(o.length === 2, `Outlook's From:/Sent: block splits too (got ${o.length})`);
  assert(o[0].mine && o[0].text.startsWith("Julie,"), "the quoted Outlook part is ours");
  assert(o[0].at?.startsWith("2026-07-30"), `Sent: date parsed (got ${o[0].at})`);

  const plain = splitThread("Not interested", "x@y.com");
  assert(plain.length === 1 && !plain[0].mine, "a body with no quoting stays one message");
  assert(splitThread("", "x@y.com").length === 0, "an empty body is no messages");

  console.log("thread splitter: all good");
}

if (process.argv[1]?.endsWith("thread.mjs")) demo();
