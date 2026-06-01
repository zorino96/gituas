import Link from "next/link";

import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-bg text-fg">
      <TopBar signedIn={!!session} />
      <Hero signedIn={!!session} />
      <APUM />
      <HowItWorks />
      <MoneyEngine />
      <Brain />
      <Cockpit />
      <Guardrails />
      <Pricing />
      <FAQ />
      <Footer />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-line">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-mono text-sm text-fg-dim ml-3">v0.9.4</span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-fg-dim">
          <a href="#how" className="hover:text-fg">product</a>
          <a href="#how" className="hover:text-fg">how it works</a>
          <a href="#pricing" className="hover:text-fg">pricing</a>
          <a href="#" className="hover:text-fg">changelog</a>
          <a href="#" className="hover:text-fg">docs</a>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {signedIn ? (
            <Link href="/dashboard" className="px-3 py-1.5 rounded-md bg-money text-bg font-medium hover:opacity-90">
              cockpit →
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-fg-dim hover:text-fg">sign in</Link>
              <Link href="/login" className="px-3 py-1.5 rounded-md bg-money text-bg font-medium hover:opacity-90">
                deposit $50 →
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold text-fg">
      <span className="inline-block h-6 w-6 rounded-sm bg-money grid place-items-center text-bg font-bold text-xs">G</span>
      <span className="lowercase tracking-tight">gituas</span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="border-b border-line">
      <div className="max-w-7xl mx-auto px-6 py-24 grid lg:grid-cols-[1fr_minmax(0,420px)] gap-16 items-center">
        <div>
          <div className="font-mono text-xs text-money mb-6">/ / GIVE IT TO US AND SLEEP</div>
          <h1 className="text-5xl md:text-6xl font-light tracking-tight leading-[1.05]">
            Your projects
            <br />
            <span className="text-money">run themselves.</span>
          </h1>
          <p className="mt-8 text-lg text-fg-dim leading-relaxed max-w-xl">
            gituas is an autonomous saas orchestrator for indie devs with too
            many tabs. connect a repo, fund a wallet, close the laptop. we
            deploy, market, scale, and route the earnings back to your bank.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/login"}
              className="px-5 py-3 rounded-md bg-money text-bg font-medium inline-flex items-center gap-2 shadow-money"
            >
              connect github <span aria-hidden>→</span>
            </Link>
            <span className="font-mono text-sm text-fg-dim border border-line rounded-md px-3 py-2.5">
              <span className="text-money">$</span> vibe-push --deploy --market
            </span>
          </div>
          <p className="mt-4 text-xs text-fg-dim font-mono">
            no credit card · 7-day shadow mode
          </p>
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 font-mono text-xs leading-relaxed shadow-money-lg">
          <div className="flex items-center justify-between text-fg-dim">
            <span>orchestrator.log · live</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="led" /> {currentUtcHHMMSS()} utc
            </span>
          </div>
          <hr className="my-3 border-line" />
          <pre className="whitespace-pre-wrap text-fg leading-[1.7]">
{`$ git push origin feature/checkout-v2
→ detecting changes in 14 files, 2 routes touched
→ project merch-mage
→ claude analysing PR #284 … ok 1.2s
→ gemini drafting campaign brief … ok 3.4s
→ higgsfield rendering 6s promo … rendering 47%
→ posting to x · linkedin · ig (queued for review)
→ ad budget reallocated · cpa 7.32 → 6.10 +17%`}
          </pre>
          <hr className="my-3 border-line" />
          <div className="grid grid-cols-3 gap-2 text-[10px] text-fg-dim">
            <Health label="claude" ok />
            <Health label="gemini-1.5-pro" ok />
            <Health label="higgsfield" pct={47} />
            <Health label="stripe" ok />
            <Health label="meta-graph" ok warm />
            <Health label="x-api" ok />
          </div>
        </div>
      </div>
    </section>
  );
}

function Health({ label, ok, pct, warm }: { label: string; ok?: boolean; pct?: number; warm?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`led ${pct != null ? "amber" : warm ? "mint" : ok ? "" : "dim"}`} />
      <span className="text-fg-dim">{label}</span>
      {pct != null && <span className="text-amber">{pct}%</span>}
    </div>
  );
}

function currentUtcHHMMSS() {
  // server-rendered to keep TTFB instant; clients see a static-ish value
  const d = new Date();
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function pad(n: number) { return n.toString().padStart(2, "0"); }

/* -------------------------------------------------------------------------- */

function APUM() {
  const sleeping = ["niko", "aman", "ferr", "k.lin", "pmot", "dvy", "tess", "oz", "m.cole", "reza", "s.kim"];
  return (
    <section className="border-b border-line bg-panel-2">
      <div className="max-w-7xl mx-auto px-6 py-20">
        <div className="font-mono text-xs text-money mb-3">/ / APUM · AUTONOMOUS PROJECTS UNDER MGMT</div>
        <div className="grid md:grid-cols-3 gap-6">
          <Stat label="live · processing" value="1,284" delta="↑ 142 this week" sub="jobs" />
          <Stat label="founder revenue routed · mtd" value="$842,019" sub="paid to 412 wallets · avg ticket $2,043" big money />
          <Stat label="now sleeping" value="412" sub={
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sleeping.map((s) => (
                <span key={s} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-line text-fg-dim">@{s}</span>
              ))}
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-line text-money">+ 401</span>
            </div>
          } />
        </div>
        <div className="mt-6 flex items-center gap-4 text-xs font-mono text-fg-dim">
          <span className="inline-flex items-center gap-1.5"><span className="led" /> orchestrator/v0.9.4</span>
          <span>·</span>
          <span>uptime 99.997%</span>
          <span>·</span>
          <span>412 operators awake</span>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, delta, sub, big, money }: {
  label: string; value: string; delta?: string; sub?: React.ReactNode; big?: boolean; money?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className={`mt-2 font-mono ${big ? "text-4xl" : "text-3xl"} ${money ? "text-money" : "text-fg"}`}>
        {value}
      </div>
      {delta && <div className="font-mono text-xs text-money mt-1">{delta}</div>}
      {sub && <div className="mt-2 text-xs text-fg-dim">{sub}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HowItWorks() {
  const primitives = [
    { num: "01", tag: "VAULT · SCOPED", verb: "Connect", body: "oauth your github, stripe, cloud, and socials. tokens are stored in an AES-256 vault with scoped permissions per integration." },
    { num: "02", tag: "PERSONALITY.JSON", verb: "Understand", body: "claude reads the repo, writes a project personality file: audience, utility, pricing, stack. gemini drafts a 30-day plan." },
    { num: "03", tag: "WALLET · STRIPE", verb: "Fuel", body: "deposit $50 (or more). the orchestrator allocates across channels — meta, tiktok, google ads, server, ai spend — guided by historical CPA." },
    { num: "04", tag: "AUDIT-LOG", verb: "Operate", body: "posts, ads, deploys, scaling, bug-fix PRs. every action is logged with reasoning. you approve sensitive moves; the rest just runs." },
    { num: "05", tag: "EARNINGS.LEDGER", verb: "Earn", body: "customer payments flow into stripe. we compute net per project, take 1% of gross + pass-through API cost, route the rest to your wallet." },
    { num: "06", tag: "STRIPE-CONNECT", verb: "Withdraw", body: "stripe connect handles KYC and payout. hit a button — wire, ACH, or wise — and the money lands in your bank." },
  ];
  return (
    <section id="how" className="border-b border-line">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="font-mono text-xs text-money mb-3">/ 01 — HOW IT WORKS</div>
        <h2 className="text-4xl font-light tracking-tight">Six primitives.<br /><span className="text-fg-dim">One sleeping founder.</span></h2>
        <p className="mt-4 text-fg-dim max-w-2xl">everything below compounds on top of these six steps — they are the entire surface area you ever touch.</p>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line rounded-xl overflow-hidden">
          {primitives.map((p) => (
            <div key={p.num} className="bg-panel p-6">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-money text-lg">{p.num}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{p.tag}</span>
              </div>
              <div className="mt-4 text-2xl font-light">{p.verb}</div>
              <p className="mt-2 text-sm text-fg-dim leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function MoneyEngine() {
  const steps = [
    { label: "FUEL", value: "$50.00", sub: "deposit $50" },
    { label: "ENGINE", value: "↻", sub: "allocate · ads / infra / ai" },
    { label: "HARVEST", value: "$1,204", sub: "stripe revenue" },
    { label: "WITHDRAW", value: "$1,190", sub: "→ your bank", money: true },
  ];
  return (
    <section className="border-b border-line bg-panel-2">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="font-mono text-xs text-money mb-3">/ 02 — THE MONEY ENGINE</div>
        <h2 className="text-4xl font-light tracking-tight">
          fuel → engine → harvest → <span className="text-money">withdraw</span>
        </h2>
        <p className="mt-4 text-fg-dim max-w-2xl">
          one closed loop. the wallet spends itself across ads, infra and ai calls, the customers pay,
          the ledger settles, and the bank account fills. we take 1% of gross — never of your profit, which is gameable.
        </p>

        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {steps.map((s) => (
            <div key={s.label} className={`rounded-xl border ${s.money ? "border-money/40 shadow-money" : "border-line"} bg-panel p-5`}>
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{s.label}</div>
              <div className={`mt-2 font-mono text-3xl ${s.money ? "text-money" : "text-fg"}`}>{s.value}</div>
              <div className="mt-1 text-xs text-fg-dim">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <Pill heading="1% of gross" sub="platform share" />
          <Pill heading="$10–$20/mo" sub="fixed platform fee" />
          <Pill heading="+ pass-through" sub="you pay api at cost" />
          <Pill heading="0% of profit" sub="we never touch it" money />
        </div>
      </div>
    </section>
  );
}

function Pill({ heading, sub, money }: { heading: string; sub: string; money?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <div className={`font-mono ${money ? "text-money" : "text-fg"}`}>{heading}</div>
      <div className="text-xs text-fg-dim mt-1">{sub}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Brain() {
  const models = [
    { name: "claude", tag: "code comprehension · bug-fix prs", load: 78, stat: "merged 142 PRs this week" },
    { name: "gemini 1.5 pro", tag: "long-context research · plans", load: 64, stat: "drafted 18 30-day plans" },
    { name: "higgsfield + sora", tag: "video creative", load: 92, stat: "rendering 6s spot · 47%" },
    { name: "flux / midjourney", tag: "static imagery", load: 41, stat: "1,204 assets generated" },
    { name: "router", tag: "picks which model per task", load: 22, stat: "saved $1,840 in api spend" },
    { name: "vector mem", tag: "per-tenant memory · no leakage", load: 58, stat: "412 partitions warm" },
  ];
  return (
    <section className="border-b border-line">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="font-mono text-xs text-money mb-3">/ 03 — MULTI-MODEL BRAIN</div>
        <h2 className="text-4xl font-light tracking-tight">
          one brain is brittle.<br />
          <span className="text-fg-dim">we run six and let the router pick.</span>
        </h2>
        <p className="mt-4 text-fg-dim max-w-2xl">catastrophic forgetting handled. per-tenant vector partitions stop project A's context from bleeding into project B.</p>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line rounded-xl overflow-hidden">
          {models.map((m) => (
            <div key={m.name} className="bg-panel p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg lowercase">{m.name}</span>
                <span className="font-mono text-xs text-money">load · {m.load}%</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mt-1">{m.tag}</div>
              <div className="mt-4 h-1 rounded-full bg-line overflow-hidden">
                <div className="h-full bg-money" style={{ width: `${m.load}%` }} />
              </div>
              <div className="mt-3 text-xs text-fg-dim">{m.stat}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Cockpit() {
  return (
    <section className="border-b border-line bg-panel-2">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="font-mono text-xs text-money mb-3">/ 04 — THE COCKPIT</div>
        <h2 className="text-4xl font-light tracking-tight">glance once. <span className="text-money">sleep again.</span></h2>

        <div className="mt-10 rounded-xl border border-line bg-panel overflow-hidden shadow-money-lg">
          <div className="border-b border-line px-5 py-3 flex items-center justify-between font-mono text-xs">
            <div className="flex items-center gap-3">
              <span className="inline-block h-2 w-2 rounded-full bg-red" />
              <span className="inline-block h-2 w-2 rounded-full bg-amber" />
              <span className="inline-block h-2 w-2 rounded-full bg-money" />
              <span className="ml-3 text-fg-dim">gituas COCKPIT</span>
            </div>
            <span className="text-fg-dim">⌕ jump · cmd-k</span>
          </div>

          <div className="p-6 grid lg:grid-cols-[1fr_320px] gap-6">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">your fleet · today</div>
              <div className="mt-2 font-mono text-4xl">
                <span className="text-money">$3,840.22</span>
                <span className="text-fg-dim text-base ml-3">↑ 18% wow · 14 projects awake</span>
              </div>

              <div className="mt-6 grid grid-cols-4 gap-2">
                {[ ["M", "merch-mage", "$1,204", "+18%"], ["N", "nicely-typed", "$842", "+24%"], ["V", "vibedb", "$640", "+6%"], ["S", "sleep-cli", "$0", "hibernated"] ].map(([mark, name, rev, delta]) => (
                  <div key={name} className="rounded-md border border-line p-3">
                    <div className="flex items-center justify-between">
                      <span className="h-7 w-7 grid place-items-center rounded-sm bg-money/10 text-money font-mono text-sm">{mark}</span>
                      <span className="font-mono text-[10px] text-fg-dim">{delta}</span>
                    </div>
                    <div className="mt-2 text-xs lowercase">{name}</div>
                    <div className="font-mono text-sm text-fg">{rev}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-line bg-panel-2 p-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                <span className="text-fg-dim">approvals · 12 waiting</span>
                <span className="text-amber">auto in 14m</span>
              </div>
              <ul className="mt-3 space-y-2 text-xs">
                <ApprovalRow actor="@gemini" project="merch-mage" action="tiktok promo" spend="$10" />
                <ApprovalRow actor="@claude" project="merch-mage" action="merge PR #284 · checkout v2" spend="MERGE" />
                <ApprovalRow actor="@gemini" project="vibedb" action="instagram carousel" spend="$0" />
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ApprovalRow({ actor, project, action, spend }: { actor: string; project: string; action: string; spend: string }) {
  return (
    <li className="rounded-md border border-line p-3 bg-panel">
      <div className="flex items-center justify-between font-mono text-[10px]">
        <span className="text-fg-dim">{actor}</span>
        <span className="text-money">{spend}</span>
      </div>
      <div className="mt-1 lowercase">{action} · <span className="text-fg-dim">{project}</span></div>
      <div className="mt-2 flex gap-2 font-mono text-[10px]">
        <button className="px-2 py-1 rounded bg-money text-bg">approve</button>
        <button className="px-2 py-1 rounded border border-line text-fg-dim">edit</button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function Guardrails() {
  const items = [
    ["kill-switch", "stop any agent in one tap"],
    ["hibernation", "0-traffic projects → static page after 30d"],
    ["budget caps", "per-tenant, per-channel, per-day"],
    ["rate-limits", "platform-aware, never trip anti-spam"],
    ["human-in-loop", "configurable per action type"],
    ["AES-256 vault", "tokens never leave encrypted"],
  ];
  return (
    <section className="border-b border-line">
      <div className="max-w-7xl mx-auto px-6 py-24 grid lg:grid-cols-2 gap-12">
        <div>
          <div className="font-mono text-xs text-money mb-3">/ 05 — AUTONOMY WITH GUARDRAILS</div>
          <h2 className="text-4xl font-light tracking-tight">we say autonomous, <span className="text-fg-dim">not unsupervised.</span></h2>
          <p className="mt-4 text-fg-dim">every action the AI takes is written to an immutable audit log, with the reasoning. you can read it tuesday morning over coffee — or stop the agent mid-sentence from your phone.</p>

          <div className="mt-8 grid grid-cols-2 gap-3 text-sm">
            {items.map(([k, v]) => (
              <div key={k} className="rounded-md border border-line bg-panel px-3 py-2.5">
                <div className="font-mono text-xs text-money">{k}</div>
                <div className="text-fg-dim text-xs mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 font-mono text-xs">
          <div className="flex items-center justify-between text-fg-dim">
            <span>audit.log · last 24h · merch-mage</span>
            <span className="inline-flex items-center gap-1.5"><span className="led red" /> recording</span>
          </div>
          <hr className="my-3 border-line" />
          <ul className="space-y-3">
            <AuditRow time="14:02:31" actor="@claude" action="merge PR #284" why="tests passing · no API surface changed · risk: low" />
            <AuditRow time="14:01:18" actor="@gemini" action="draft tiktok caption" why="merged feature is user-facing · trending sound matched" />
            <AuditRow time="13:58:02" actor="@router" action="pause google-ads ad #44" why="cpa $9.21 > 90d ltv $7.40" warn />
            <AuditRow time="13:42:55" actor="@claude" action="open issue #312" why="stripe webhook 429s · suggest exponential backoff" />
          </ul>
        </div>
      </div>
    </section>
  );
}

function AuditRow({ time, actor, action, why, warn }: { time: string; actor: string; action: string; why: string; warn?: boolean }) {
  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span className="text-fg-dim">{time}</span>
        <span className={warn ? "text-amber" : "text-money"}>{actor}</span>
        <span className="text-fg lowercase">{action}</span>
      </div>
      <div className="pl-12 text-fg-dim leading-relaxed">↳ <span className="text-fg-dim">{why}</span></div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function Pricing() {
  return (
    <section id="pricing" className="border-b border-line bg-panel-2">
      <div className="max-w-7xl mx-auto px-6 py-24">
        <div className="font-mono text-xs text-money mb-3">/ 06 — PRICING</div>
        <h2 className="text-4xl font-light tracking-tight">pay-as-you-go. <span className="text-money">we win when you do.</span></h2>
        <p className="mt-4 text-fg-dim max-w-2xl">1% of gross revenue per managed project. a small monthly platform fee. api costs at cost.</p>

        <div className="mt-12 grid md:grid-cols-3 gap-3">
          <Tier
            name="solo"
            price="$10/mo"
            sub="+ 1% of gross · pass-through api"
            features={[
              "up to 5 projects",
              "approval queue",
              "wallet & withdraw",
              "audit log · 30d",
              "email alerts",
            ]}
            cta="choose solo"
          />
          <Tier
            name="operator"
            price="$20/mo"
            sub="+ 1% of gross · pass-through api"
            features={[
              "unlimited projects",
              "priority agent routing",
              "custom approval rules",
              "audit log · 1y",
              "discord + telegram cockpit",
              "auto-hibernation",
              "stripe-connect express",
            ]}
            cta="start operating →"
            highlight
          />
          <Tier
            name="conglomerate"
            price="let's talk"
            sub="for indie-hacker collectives & studios"
            features={[
              "everything in operator",
              "white-label dashboard",
              "team seats + RBAC",
              "dedicated vault partition",
              "SOC2-lite handoff",
              "founder concierge",
            ]}
            cta="choose conglomerate"
          />
        </div>
      </div>
    </section>
  );
}

function Tier({ name, price, sub, features, cta, highlight }: {
  name: string; price: string; sub: string; features: string[]; cta: string; highlight?: boolean;
}) {
  return (
    <div className={`relative rounded-xl border ${highlight ? "border-money/60 shadow-money" : "border-line"} bg-panel p-6`}>
      {highlight && (
        <span className="absolute -top-3 right-4 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-money text-bg">
          most chosen
        </span>
      )}
      <div className="font-mono text-xs uppercase tracking-wider text-fg-dim">{name}</div>
      <div className="mt-3 text-3xl font-mono">{price}</div>
      <div className="mt-1 text-xs text-fg-dim">{sub}</div>
      <ul className="mt-5 space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="text-money mt-0.5">✓</span>
            <span className="text-fg-dim">{f}</span>
          </li>
        ))}
      </ul>
      <a href="/login" className={`mt-6 block text-center rounded-md py-2.5 ${highlight ? "bg-money text-bg" : "border border-line text-fg hover:bg-line"}`}>
        {cta}
      </a>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FAQ() {
  const qs = [
    ["so you take 1% of profit?", "1% of gross revenue actually — profit is gameable and hard to audit, gross is objective from stripe. we never touch your margins."],
    ["what happens to a project nobody buys?", "auto-hibernation. after 30 days of zero traffic the project gets parked on a static page and stops costing you anything in agents."],
    ["does my code leave my machine?", "claude reads the repo via the github API with read-only scoped tokens. the personality file we generate stays in your tenant partition."],
    ["what if the AI posts something dumb?", "every outbound action defaults to your approval queue. you flip rules on per action type when you trust the brain."],
    ["multi-tenant context bleed?", "per-tenant vector partitions. project A's embeddings can't reach project B's prompts. enforced at the retrieval layer, not by good vibes."],
  ];
  return (
    <section className="border-b border-line">
      <div className="max-w-4xl mx-auto px-6 py-24">
        <div className="font-mono text-xs text-money mb-3">/ 07 — QUESTIONS</div>
        <h2 className="text-4xl font-light tracking-tight">the things <span className="text-fg-dim">everyone asks.</span></h2>
        <div className="mt-12 space-y-px bg-line border border-line rounded-xl overflow-hidden">
          {qs.map(([q, a]) => (
            <details key={q} className="bg-panel group">
              <summary className="px-5 py-4 cursor-pointer flex items-center justify-between font-medium">
                <span className="lowercase">{q}</span>
                <span className="font-mono text-money group-open:rotate-45 transition-transform">+</span>
              </summary>
              <div className="px-5 pb-5 text-sm text-fg-dim leading-relaxed">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 text-sm text-fg-dim max-w-sm">
              give it to us and sleep. a multi-tenant autonomous saas orchestrator for indie devs with too many tabs.
            </p>
          </div>
          <FooterCol heading="product" items={["fleet", "wallet", "agents", "approvals", "audit"]} />
          <FooterCol heading="platform" items={["github", "stripe", "vercel", "meta", "tiktok"]} />
          <FooterCol heading="company" items={["about", "manifesto", "careers", "press", "changelog"]} />
        </div>
        <hr className="my-10 border-line" />
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-fg-dim">
          <span>© 2026 GITUAS LABS · MADE WITH TOO MUCH COFFEE BY ONE PERSON</span>
          <span>v0.9.4 · uptime 99.997% · 412 founders sleeping</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">{heading}</div>
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i}><a href="#" className="text-fg-dim hover:text-fg lowercase">{i}</a></li>
        ))}
      </ul>
    </div>
  );
}
