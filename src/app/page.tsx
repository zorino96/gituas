import Link from "next/link";

import { auth } from "@/auth";
import { CountUp } from "@/components/marketing/count-up";

export default async function Home() {
  const session = await auth();
  const signedIn = !!session;

  return (
    <div className="relative min-h-screen text-fg overflow-x-clip">
      <NightSky />
      <div className="relative z-10">
        <TopBar signedIn={signedIn} />
        <Hero signedIn={signedIn} />
        <Digest />
        <Rituals />
        <MoneyEngine />
        <Constellation />
        <Guardrails />
        <Pricing signedIn={signedIn} />
        <FAQ />
        <Footer />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── atmosphere ── */

function NightSky() {
  return (
    <div className="nightsky" aria-hidden>
      <div className="aurora" />
      <div className="stars" />
      <div className="stars-2" />
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}

function MoonGlyph({ size = 14 }: { size?: number }) {
  return <span className="moon inline-block align-middle" style={{ width: size, height: size }} />;
}

function Divider() {
  return (
    <div className="max-w-6xl mx-auto px-6 flex items-center gap-4 py-2">
      <span className="hairline flex-1" />
      <MoonGlyph size={10} />
      <span className="hairline flex-1" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── top bar ── */

function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-line/60">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <MoonGlyph size={22} />
          <span className="font-display text-xl tracking-tight">gituas</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-fg-dim">
          <a href="#digest" className="ul-grow hover:text-fg transition-colors">the night shift</a>
          <a href="#rituals" className="ul-grow hover:text-fg transition-colors">rituals</a>
          <a href="#minds" className="ul-grow hover:text-fg transition-colors">the minds</a>
          <a href="#pricing" className="ul-grow hover:text-fg transition-colors">pricing</a>
        </nav>
        <div className="flex items-center gap-4 text-sm">
          {signedIn ? (
            <Link href="/dashboard" className="rounded-full bg-money text-bg px-4 py-2 font-medium hover:shadow-money transition-shadow">
              the night desk →
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-fg-dim hover:text-fg transition-colors">sign in</Link>
              <Link href="/login" className="rounded-full bg-money text-bg px-4 py-2 font-medium hover:shadow-money transition-shadow">
                start the night shift
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── hero ── */

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative">
      {/* the moon, grid-breaking, upper right */}
      <div
        className="pointer-events-none absolute hidden lg:block"
        style={{ width: 340, height: 340, right: "-30px", top: "48px" }}
        aria-hidden
      >
        <span className="moon block w-full h-full" />
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-24 pb-28 lg:pt-32 lg:pb-36 relative">
        <p className="reveal font-mono text-xs tracking-[0.25em] text-money uppercase" style={{ animationDelay: "0.05s" }}>
          give it to us and sleep
        </p>

        <h1
          className="reveal font-display mt-8 leading-[0.98] tracking-[-0.02em]"
          style={{ animationDelay: "0.15s", fontSize: "clamp(2.8rem, 7vw, 6.2rem)" }}
        >
          <span className="block italic font-light">While you slept,</span>
          <span className="block">
            your software shipped,
          </span>
          <span className="block">
            posted, and{" "}
            <span className="text-money text-glow">got paid.</span>
          </span>
        </h1>

        <p
          className="reveal mt-8 max-w-xl text-lg text-fg-dim leading-relaxed"
          style={{ animationDelay: "0.3s" }}
        >
          Gituas is the night shift for indie software. Connect a repo, fund the wallet,
          close the laptop. Our agents deploy, market, scale, and route the earnings to
          your bank — and leave a note for the morning.
        </p>

        {/* overnight earnings — the count-up */}
        <div className="reveal mt-12 flex flex-wrap items-end gap-x-12 gap-y-6" style={{ animationDelay: "0.42s" }}>
          <div>
            <div className="font-mono text-[11px] tracking-[0.2em] uppercase text-fg-dim">
              earned while you slept · 23:00–07:00
            </div>
            <div className="font-display text-money text-glow mt-2" style={{ fontSize: "clamp(3.2rem, 8vw, 5.5rem)", lineHeight: 1 }}>
              <CountUp to={4210} prefix="$" duration={2400} />
            </div>
          </div>
          <div className="space-y-1 pb-3">
            <Tally label="agents on shift" value="7" />
            <Tally label="your interventions" value="0" />
            <Tally label="hours unattended" value="8.0" />
          </div>
        </div>

        <div className="reveal mt-12 flex flex-wrap items-center gap-4" style={{ animationDelay: "0.55s" }}>
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="group rounded-full bg-money text-bg px-7 py-3.5 font-medium inline-flex items-center gap-2 shadow-money hover:shadow-money-lg transition-all"
          >
            connect github
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
          <a href="#digest" className="text-fg-dim hover:text-fg ul-grow text-sm">read last night&apos;s log</a>
          <span className="font-mono text-xs text-fg-dim">no card · 7-day shadow mode</span>
        </div>
      </div>

      {/* last-night log ticker */}
      <div className="border-y border-line/60 bg-panel/40 backdrop-blur-sm overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 font-mono text-xs text-fg-dim whitespace-nowrap overflow-x-auto">
          <span className="inline-flex items-center gap-1.5 text-money shrink-0"><span className="led" /> orchestrator.log</span>
          <Sep />
          <span>02:14 <span className="text-money">@claude</span> merged PR #284</span>
          <Sep />
          <span>03:02 <span className="text-mint">@gemini</span> drafted 3 posts</span>
          <Sep />
          <span>04:41 <span className="text-amber">@router</span> paused google-ads · cpa&gt;ltv</span>
          <Sep />
          <span>05:50 <span className="text-mint">@gemini</span> answered 2 DMs</span>
          <Sep />
          <span>06:30 stripe · +$266 · 14 customers</span>
        </div>
      </div>
    </section>
  );
}

function Tally({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-fg text-lg">{value}</span>
      <span className="text-xs text-fg-dim">{label}</span>
    </div>
  );
}
function Sep() {
  return <span className="text-line shrink-0">·</span>;
}

/* ────────────────────────────────────────────────── the morning digest ── */

function Digest() {
  const log = [
    { t: "23:18", who: "@claude", tone: "money", act: "shipped checkout-v2 to production", why: "tests green · no api surface change · risk low" },
    { t: "01:02", who: "@gemini", tone: "mint", act: "posted the reddit build-in-public thread", why: "trending in r/SideProject · sentiment +0.8" },
    { t: "03:44", who: "@router", tone: "amber", act: "moved $20 from x-ads → retargeting", why: "x cpa $9.21 > 90d ltv $7.40" },
    { t: "05:31", who: "@gemini", tone: "mint", act: "replied to 2 DMs, escalated 1 to you", why: "refund request needs a human call" },
    { t: "06:30", who: "stripe", tone: "money", act: "settled 14 new subscriptions", why: "net +$266.00 routed to wallet" },
  ];
  return (
    <section id="digest" className="max-w-6xl mx-auto px-6 py-28">
      <div className="rise-in grid lg:grid-cols-[0.9fr_1.1fr] gap-12 items-start">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">the morning note</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 leading-tight tracking-tight">
            You wake to a<br /><span className="italic font-light">note, not a fire.</span>
          </h2>
          <p className="mt-6 text-fg-dim leading-relaxed">
            Every night the fleet works and writes down exactly what it did, and why.
            No dashboards to decode at 9am — just a short, honest brief and a tiny queue
            of the few things that genuinely needed you.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link href="/login" className="rounded-full border border-money/60 text-money px-5 py-2.5 text-sm hover:bg-money/10 transition-colors">
              approve the morning queue · 3
            </Link>
          </div>
        </div>

        {/* the statement card */}
        <div className="rounded-2xl border border-line bg-panel/80 backdrop-blur-md shadow-money-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MoonGlyph size={18} />
              <div>
                <div className="font-display text-lg">Good morning, niko.</div>
                <div className="font-mono text-[11px] text-fg-dim">7 projects · 8h unattended · 0 incidents</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">overnight net</div>
              <div className="font-display text-money text-2xl text-glow">+$4,210</div>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {log.map((l) => (
              <li key={l.t} className="px-6 py-4 hover:bg-panel-2/60 transition-colors">
                <div className="flex items-baseline gap-3 font-mono text-xs">
                  <span className="text-fg-dim w-12 shrink-0">{l.t}</span>
                  <span className={`shrink-0 ${l.tone === "money" ? "text-money" : l.tone === "mint" ? "text-mint" : "text-amber"}`}>{l.who}</span>
                  <span className="text-fg">{l.act}</span>
                </div>
                <div className="pl-[3.75rem] mt-1 text-[13px] text-fg-dim">
                  <span className="text-money">↳</span> {l.why}
                </div>
              </li>
            ))}
          </ul>
          <div className="px-6 py-4 border-t border-line flex items-center justify-between font-mono text-[11px] text-fg-dim">
            <span>tail -f · last 8 hours</span>
            <span className="inline-flex items-center gap-1.5"><span className="led mint" /> all systems nominal</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────── six rituals ── */

function Rituals() {
  const steps = [
    { n: "I", title: "Connect", body: "OAuth your github, stripe, cloud and socials into an AES-256 vault. scoped per integration." },
    { n: "II", title: "Understand", body: "claude reads the repo and writes a personality file. gemini drafts a 30-day plan." },
    { n: "III", title: "Fuel", body: "deposit $50. the wallet allocates across ads, infra and AI by historical CPA." },
    { n: "IV", title: "Operate", body: "posts, ads, deploys, replies, bug-fix PRs — each logged with its reasoning." },
    { n: "V", title: "Earn", body: "customers pay stripe. we take 1% of gross, never your margin, and route the rest." },
    { n: "VI", title: "Withdraw", body: "stripe connect handles KYC. one tap — wire, ACH or wise — and it lands in your bank." },
  ];
  return (
    <section id="rituals" className="border-t border-line/60">
      <Divider />
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="rise-in">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">how it works</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 tracking-tight">
            Six rituals, <span className="italic font-light">then silence.</span>
          </h2>
        </div>
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-12">
          {steps.map((s, i) => (
            <div key={s.n} className="rise-in" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex items-baseline gap-3">
                <span className="font-display italic text-money text-2xl">{s.n}</span>
                <span className="hairline flex-1 translate-y-[-4px]" />
              </div>
              <h3 className="font-display text-2xl mt-4">{s.title}</h3>
              <p className="mt-2 text-sm text-fg-dim leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────── money engine ── */

function MoneyEngine() {
  const flow = [
    { k: "fuel", v: "$50", note: "you deposit once" },
    { k: "engine", v: "↻", note: "spends itself · ads / infra / ai" },
    { k: "harvest", v: "$1,204", note: "customers pay stripe" },
    { k: "withdraw", v: "$1,190", note: "lands in your bank", gold: true },
  ];
  return (
    <section className="border-t border-line/60">
      <Divider />
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="rise-in max-w-2xl">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">the money engine</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 tracking-tight leading-tight">
            The wallet that <span className="italic font-light text-money text-glow">spends itself.</span>
          </h2>
          <p className="mt-6 text-fg-dim leading-relaxed">
            one closed loop. the wallet funds ads, infra and ai calls; customers pay;
            the ledger settles; your bank fills. we take 1% of gross — never your profit, which is gameable.
          </p>
        </div>

        <div className="rise-in mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {flow.map((f, i) => (
            <div key={f.k} className="relative">
              <div className={`rounded-2xl border ${f.gold ? "border-money/50 shadow-money" : "border-line"} bg-panel/70 backdrop-blur-sm p-6 h-full`}>
                <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-fg-dim">{f.k}</div>
                <div className={`font-display mt-3 ${f.gold ? "text-money text-glow" : "text-fg"}`} style={{ fontSize: "2.4rem", lineHeight: 1 }}>{f.v}</div>
                <div className="mt-2 text-xs text-fg-dim">{f.note}</div>
              </div>
              {i < flow.length - 1 && (
                <span className="hidden lg:block absolute top-1/2 -right-3 -translate-y-1/2 text-money/60 font-mono z-10">→</span>
              )}
            </div>
          ))}
        </div>

        <div className="rise-in mt-6 grid sm:grid-cols-4 gap-4 font-mono text-xs">
          <Term big="1%" small="of gross — our share" />
          <Term big="$10–20" small="/mo platform fee" />
          <Term big="at cost" small="you pay api directly" />
          <Term big="0%" small="of your profit, ever" gold />
        </div>
      </div>
    </section>
  );
}

function Term({ big, small, gold }: { big: string; small: string; gold?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel/50 px-4 py-3">
      <div className={`text-base ${gold ? "text-money" : "text-fg"}`}>{big}</div>
      <div className="text-fg-dim mt-0.5">{small}</div>
    </div>
  );
}

/* ───────────────────────────────────────────── constellation of minds ── */

function Constellation() {
  // positions in a 100x100 viewBox; brightest = router
  const minds = [
    { id: "claude", x: 22, y: 30, r: 4.2, role: "code · bug-fix PRs" },
    { id: "gemini", x: 50, y: 18, r: 4.6, role: "research · plans · drafts" },
    { id: "router", x: 50, y: 52, r: 6.4, role: "picks the right mind", bright: true },
    { id: "higgsfield", x: 78, y: 32, r: 4, role: "video creative" },
    { id: "flux", x: 30, y: 72, r: 3.6, role: "static imagery" },
    { id: "vector mem", x: 74, y: 70, r: 3.8, role: "per-tenant memory" },
  ];
  const edges: [number, number][] = [[2, 0], [2, 1], [2, 3], [2, 4], [2, 5]];
  return (
    <section id="minds" className="border-t border-line/60">
      <Divider />
      <div className="max-w-6xl mx-auto px-6 py-24 grid lg:grid-cols-2 gap-14 items-center">
        <div className="rise-in">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">the multi-model brain</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 tracking-tight leading-tight">
            Six minds.<br /><span className="italic font-light">One picks.</span>
          </h2>
          <p className="mt-6 text-fg-dim leading-relaxed">
            one model is brittle. gituas runs six and lets a router choose per task —
            then keeps each tenant&apos;s memory in its own vector partition, so project A&apos;s
            context never bleeds into project B.
          </p>
          <ul className="mt-8 space-y-2.5">
            {minds.map((m) => (
              <li key={m.id} className="flex items-center gap-3 text-sm">
                <span className={`led ${m.bright ? "" : "mint"}`} />
                <span className="font-mono text-fg">{m.id}</span>
                <span className="text-fg-dim">— {m.role}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* the star map */}
        <div className="rise-in relative aspect-square max-w-md mx-auto w-full">
          <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
            {edges.map(([a, b], i) => (
              <line
                key={i}
                x1={minds[a].x} y1={minds[a].y} x2={minds[b].x} y2={minds[b].y}
                stroke="rgba(227,178,60,0.28)" strokeWidth="0.3"
              />
            ))}
            {minds.map((m) => (
              <g key={m.id}>
                <circle cx={m.x} cy={m.y} r={m.r + 3} fill="rgba(227,178,60,0.10)" />
                <circle cx={m.x} cy={m.y} r={m.r} fill={m.bright ? "#f3d691" : "#e3b23c"} opacity={m.bright ? 1 : 0.85} />
                <text x={m.x} y={m.y + m.r + 4.5} textAnchor="middle" fontSize="3.1" fill="#97a0bd" fontFamily="var(--font-spline-mono)">{m.id}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────── guardrails ── */

function Guardrails() {
  const items = [
    ["kill switch", "stop any agent in one tap"],
    ["hibernation", "0-traffic projects sleep after 30d"],
    ["budget caps", "per-tenant, per-channel, per-day"],
    ["human-in-loop", "configurable per action type"],
    ["rate limits", "platform-aware, never trips anti-spam"],
    ["AES-256 vault", "tokens never leave encrypted"],
  ];
  return (
    <section className="border-t border-line/60">
      <Divider />
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="rise-in max-w-2xl">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">autonomy with guardrails</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 tracking-tight leading-tight">
            Autonomous. <span className="italic font-light">Never unsupervised.</span>
          </h2>
          <p className="mt-6 text-fg-dim leading-relaxed">
            every action is written to an immutable audit log with its reasoning. read it
            tuesday over coffee — or stop the agent mid-sentence from your phone.
          </p>
        </div>
        <div className="rise-in mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line rounded-2xl overflow-hidden">
          {items.map(([k, v]) => (
            <div key={k} className="bg-panel/70 backdrop-blur-sm p-6">
              <div className="flex items-center gap-2.5">
                <span className="led" />
                <span className="font-mono text-sm text-money">{k}</span>
              </div>
              <p className="mt-2 text-sm text-fg-dim">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────── pricing ── */

function Pricing({ signedIn }: { signedIn: boolean }) {
  const tiers = [
    {
      name: "solo", price: "$10", per: "/mo", sub: "+ 1% of gross · api at cost",
      feats: ["up to 5 projects", "approval queue", "wallet & withdraw", "audit log · 30d", "email alerts"],
      cta: "choose solo",
    },
    {
      name: "operator", price: "$20", per: "/mo", sub: "+ 1% of gross · api at cost",
      feats: ["unlimited projects", "priority routing", "custom approval rules", "audit log · 1y", "discord + telegram cockpit", "auto-hibernation", "stripe-connect express"],
      cta: "start operating", highlight: true,
    },
    {
      name: "conglomerate", price: "let's talk", per: "", sub: "for collectives & studios",
      feats: ["everything in operator", "white-label dashboard", "team seats + RBAC", "dedicated vault partition", "SOC2-lite handoff", "founder concierge"],
      cta: "choose conglomerate",
    },
  ];
  return (
    <section id="pricing" className="border-t border-line/60">
      <Divider />
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="rise-in text-center max-w-2xl mx-auto">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">pricing</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 tracking-tight leading-tight">
            Pay the night shift <span className="italic font-light text-money text-glow">only when it earns.</span>
          </h2>
          <p className="mt-6 text-fg-dim">1% of gross per managed project. a small monthly fee. api at cost.</p>
        </div>

        <div className="rise-in mt-14 grid md:grid-cols-3 gap-4 items-start">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-2xl border p-7 ${t.highlight ? "border-money/60 bg-panel/90 shadow-money-lg lg:-translate-y-3" : "border-line bg-panel/60"} backdrop-blur-sm`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.2em] uppercase px-3 py-1 rounded-full bg-money text-bg">
                  most chosen
                </span>
              )}
              <div className="font-mono text-xs tracking-[0.2em] uppercase text-fg-dim">{t.name}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl">{t.price}</span>
                <span className="text-fg-dim text-sm">{t.per}</span>
              </div>
              <div className="mt-1 text-xs text-fg-dim">{t.sub}</div>
              <ul className="mt-6 space-y-2.5 text-sm">
                {t.feats.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="text-money mt-0.5">✦</span>
                    <span className="text-fg-dim">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={signedIn ? "/dashboard" : "/login"}
                className={`mt-7 block text-center rounded-full py-2.5 text-sm font-medium transition-all ${
                  t.highlight ? "bg-money text-bg hover:shadow-money" : "border border-line text-fg hover:border-money/50 hover:text-money"
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────── faq ── */

function FAQ() {
  const qs: [string, string][] = [
    ["so you take 1% of profit?", "1% of gross revenue, actually — profit is gameable and hard to audit; gross is objective from stripe. we never touch your margin."],
    ["does my code leave my machine?", "claude reads the repo via github's API with read-only scoped tokens. the personality file we generate lives in your tenant partition, encrypted."],
    ["what if an agent posts something dumb?", "every outbound action defaults to your approval queue. you relax rules per action type only once you trust the brain."],
    ["what happens to a project nobody buys?", "auto-hibernation. after 30 days of zero traffic it parks on a static page and stops spending your wallet."],
    ["multi-tenant context bleed?", "per-tenant vector partitions, enforced at the retrieval layer — not by good vibes. project A's embeddings can't reach project B's prompts."],
  ];
  return (
    <section className="border-t border-line/60">
      <Divider />
      <div className="max-w-3xl mx-auto px-6 py-24">
        <div className="rise-in text-center">
          <p className="font-mono text-xs tracking-[0.25em] uppercase text-money">questions</p>
          <h2 className="font-display text-4xl md:text-5xl mt-5 tracking-tight">
            The things <span className="italic font-light">everyone asks.</span>
          </h2>
        </div>
        <div className="rise-in mt-12 space-y-px bg-line border border-line rounded-2xl overflow-hidden">
          {qs.map(([q, a]) => (
            <details key={q} className="group bg-panel/70 backdrop-blur-sm">
              <summary className="px-6 py-5 cursor-pointer flex items-center justify-between gap-4">
                <span className="font-display text-lg">{q}</span>
                <span className="text-money font-mono text-xl transition-transform group-open:rotate-45 shrink-0">+</span>
              </summary>
              <p className="px-6 pb-6 text-sm text-fg-dim leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────── footer ── */

function Footer() {
  return (
    <footer className="border-t border-line/60">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <MoonGlyph size={20} />
              <span className="font-display text-xl">gituas</span>
            </div>
            <p className="mt-4 text-sm text-fg-dim max-w-xs leading-relaxed">
              the night shift for indie software. give it to us and sleep.
            </p>
          </div>
          <FootCol head="product" items={["the night desk", "wallet", "the minds", "approvals", "audit"]} />
          <FootCol head="platform" items={["github", "stripe", "vercel", "meta", "tiktok"]} />
          <FootCol head="company" items={["manifesto", "changelog", "privacy", "terms", "status"]} />
        </div>
        <div className="hairline my-10" />
        <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-fg-dim">
          <span>© 2026 gituas labs · made after dark</span>
          <span className="inline-flex items-center gap-2"><span className="led" /> v0.9.4 · 412 founders sleeping</span>
        </div>
      </div>
    </footer>
  );
}

function FootCol({ head, items }: { head: string; items: string[] }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-fg-dim mb-3">{head}</div>
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i}><a href="#" className="text-fg-dim hover:text-money ul-grow transition-colors">{i}</a></li>
        ))}
      </ul>
    </div>
  );
}
