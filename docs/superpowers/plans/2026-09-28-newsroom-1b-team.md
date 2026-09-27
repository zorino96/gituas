# Newsroom 1B — Team, roles, invites, several desks · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel's owner can invite a team into a newsroom desk with the roles owner (خاوەن), editor (سەرنووسەر) and writer (نووسەر). Each role can do only what it is allowed to, and a person can work in several desks and switch between them.

**Architecture:**
- **Workspace lookup.** Today it is "the tenant I own". It becomes "the tenant I'm a member of, chosen by the `gm_ws` cookie". The cookie is validated against the memberships on every read, and the default is the earliest *claimed* membership.
- **Roles.** They reuse `MembershipRole` (OWNER/ADMIN/MEMBER). One pure matrix, `can(role, permission)`, is checked in every server action.
- **Invites.** A new `Invite` table stores only a SHA-256 of the token. The owner gets the link on screen (to send on WhatsApp) and by email. Accepting requires signing in with that exact, verified email.
- **Scope.** The operator `/dashboard` keeps its `ownerId` lookups and is untouched.

**Tech Stack:** Next.js 16 App Router (server actions, `cookies()`), React 19 (`useActionState`), Prisma 7 on Postgres, vitest, Resend via `src/lib/mailer.ts`.

**Spec:** `docs/superpowers/specs/2026-09-28-newsroom-big-media-phase1-design.md`, section 1B.

**Branch:** `newsroom-1b`, cut from `master`.

**Facts checked on 2026-09-28:**
- All 7 tenants have an OWNER membership for their owner, and no user has more than one membership, so no backfill is needed.
- Locally, `.env.local` has `EMAIL_DEV_LOG=1` and no `RESEND_API_KEY`, so local emails are logged, not sent.

**Deviation from spec, noted:** signing up via an invite link still creates the invitee's own empty, *unclaimed* workspace. `ensureWorkspace` runs on every new account, and changing that touches sign-up for both products. This is harmless:
- it's never picked while a claimed desk exists;
- it's never shown in the switcher, which lists claimed desks only;
- it's only claimed if the person opens a product with it.

---

## Conventions for every task

- UI text is Sorani Kurdish, RTL. Kurdish digits come from `num()` in `src/app/app/format.ts`.
- Tests live in `tests/**/*.test.ts`. Run them with `npx vitest run <file>`; the `@/` alias maps to `src/`.
- Type check with `npx tsc --noEmit`, which must print nothing.
- Commit messages are plain sentences and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never print `.env*` values.
- The shell is Git Bash on Windows; quote paths that contain parentheses.
- Every mutation is scoped with `tenantId: ws.id` in its `where`. Never trust an id from the client without that scope.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/newsroom/roles.ts` | create | Role type, permission matrix `can()`, labels, messages |
| `src/lib/workspace/pick.ts` | create | pick the active workspace from memberships + cookie |
| `src/lib/newsroom/invite.ts` | create | token make/hash, invite state, email normalising, link |
| `src/lib/billing/plans.ts` | modify | `seats`, `desks` limits; `seatsLeft`, `deskLimit`; export `Plan` |
| `prisma/schema.prisma` | modify | `Invite` model |
| `src/app/app/data.ts` | modify | membership-based `currentWorkspace`, `listWorkspaces`, `rememberWorkspace`, `setupNewsDesk`, `role` on `Workspace` |
| `src/app/newsroom/desk-actions.ts` | create | `switchWorkspaceAction`, `createDeskAction` |
| `src/app/app/actions.ts`, `src/app/newsroom/(desk)/news/actions.ts` | modify | role checks |
| `src/app/api/oauth/[provider]/start/route.ts` | modify | active workspace + configure permission |
| `src/app/app/publish/page.tsx` | modify | writers see a notice instead of the publish form |
| `src/lib/mailer.ts` | modify | `inviteEmail` |
| `src/app/newsroom/(desk)/team/{page,team-client,actions}.tsx/.ts` | create | team screen |
| `src/app/newsroom/join/[token]/{page,join-client,actions}` | create | accepting an invite |
| `src/app/newsroom/desk-switcher.tsx` | create | desk switcher in the top bar |
| `src/app/newsroom/desk-shell.tsx`, `newsroom.css` | modify | switcher, role badge |
| `src/app/newsroom/(desk)/desks/new/{page,new-desk-form}.tsx` | create | create a desk |
| `src/app/newsroom/shop-notice.tsx`, `(desk)/layout.tsx`, `page.tsx`, `src/app/app/layout.tsx` | modify | switch instead of dead ends when the active workspace is the other product |
| `src/lib/newsroom/nav.ts`, `guide.ts`, `desk-nav.tsx` | modify | team entry, guide section |
| `tests/newsroom/{roles,pick,invite,team-limits}.test.ts` | create | tests |

---

### Task 1: Roles

**Files:** Create `src/lib/newsroom/roles.ts`. Test: `tests/newsroom/roles.test.ts`.

- [ ] **Step 1: Failing test** `tests/newsroom/roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { can, INVITABLE_ROLES, ROLE_LABEL, type Permission, type Role } from "@/lib/newsroom/roles";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

describe("can", () => {
  it("lets everyone read and draft", () => {
    for (const r of ROLES) {
      expect(can(r, "read")).toBe(true);
      expect(can(r, "draft")).toBe(true);
    }
  });
  it("keeps publishing, engaging and configuring to owners and editors", () => {
    for (const p of ["publish", "engage", "configure"] as Permission[]) {
      expect(can("OWNER", p)).toBe(true);
      expect(can("ADMIN", p)).toBe(true);
      expect(can("MEMBER", p)).toBe(false);
    }
  });
  it("keeps the team to the owner", () => {
    expect(can("OWNER", "team")).toBe(true);
    expect(can("ADMIN", "team")).toBe(false);
    expect(can("MEMBER", "team")).toBe(false);
  });
});

describe("labels and invitable roles", () => {
  it("names every role in Kurdish", () => {
    expect(ROLE_LABEL).toEqual({ OWNER: "خاوەن", ADMIN: "سەرنووسەر", MEMBER: "نووسەر" });
  });
  it("never offers ownership in an invite", () => {
    expect(INVITABLE_ROLES).toEqual(["ADMIN", "MEMBER"]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/newsroom/roles.test.ts`. It should FAIL because the module is missing.

- [ ] **Step 3: Implement** `src/lib/newsroom/roles.ts`:

```ts
// Who may do what in a workspace. Every server action checks this — hiding a
// button is never the check. Roles are the stored MembershipRole values.

export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type Permission = "read" | "draft" | "publish" | "engage" | "configure" | "team";

const ALLOWED: Record<Permission, readonly Role[]> = {
  read: ["OWNER", "ADMIN", "MEMBER"],
  draft: ["OWNER", "ADMIN", "MEMBER"],
  publish: ["OWNER", "ADMIN"],
  engage: ["OWNER", "ADMIN"],
  configure: ["OWNER", "ADMIN"],
  team: ["OWNER"],
};

export function can(role: Role, permission: Permission): boolean {
  return ALLOWED[permission].includes(role);
}

export const ROLE_LABEL: Record<Role, string> = { OWNER: "خاوەن", ADMIN: "سەرنووسەر", MEMBER: "نووسەر" };

/** Roles an owner can hand out; ownership itself is not transferable yet. */
export const INVITABLE_ROLES = ["ADMIN", "MEMBER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

export const NOT_ALLOWED = "ئەم کارە تەنها بۆ خاوەن و سەرنووسەرە.";
export const OWNER_ONLY = "ئەم کارە تەنها بۆ خاوەنی مێزەکەیە.";
```

- [ ] **Step 4:** Run the test. It should PASS with 5 tests.
- [ ] **Step 5: Commit** with the message "Define newsroom roles and what each may do".

---

### Task 2: Workspace picking, invite helpers, team limits

**Files:**
- Create `src/lib/workspace/pick.ts` and `src/lib/newsroom/invite.ts`.
- Modify `src/lib/billing/plans.ts`.
- Tests: `tests/newsroom/pick.test.ts`, `tests/newsroom/invite.test.ts`, `tests/newsroom/team-limits.test.ts`.

- [ ] **Step 1: Failing tests.**

`tests/newsroom/pick.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickWorkspace } from "@/lib/workspace/pick";

const d = (s: string) => new Date(`2026-09-${s}T00:00:00Z`);
const own = { id: "own", kindChosen: false, joinedAt: d("01") };
const desk = { id: "desk", kindChosen: true, joinedAt: d("10") };
const shop = { id: "shop", kindChosen: true, joinedAt: d("05") };

describe("pickWorkspace", () => {
  it("uses the cookie when it names one of the person's workspaces", () => {
    expect(pickWorkspace([own, desk, shop], "desk")?.id).toBe("desk");
  });
  it("ignores a cookie for a workspace the person is not in", () => {
    expect(pickWorkspace([own, desk], "someone-elses")?.id).toBe("desk");
  });
  it("prefers the earliest claimed workspace over an unclaimed one", () => {
    expect(pickWorkspace([own, desk, shop])?.id).toBe("shop");
  });
  it("falls back to the earliest workspace when none is claimed", () => {
    expect(pickWorkspace([{ ...own, joinedAt: d("09") }, { id: "b", kindChosen: false, joinedAt: d("02") }])?.id).toBe("b");
  });
  it("returns undefined for no workspaces", () => {
    expect(pickWorkspace([])).toBeUndefined();
  });
});
```

`tests/newsroom/invite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashInviteToken, INVITE_TTL_MS, inviteLink, inviteState, newInviteToken, normalizeEmail } from "@/lib/newsroom/invite";

describe("invite tokens", () => {
  it("makes a long random token and stores only its hash", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.tokenHash).toBe(hashInviteToken(a.token));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });
  it("lasts seven days", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("inviteState", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("is ok while unused and unexpired", () => {
    expect(inviteState({ acceptedAt: null, expiresAt: new Date("2026-09-29T00:00:00Z") }, now)).toBe("ok");
  });
  it("is used once accepted, even if also expired", () => {
    expect(inviteState({ acceptedAt: now, expiresAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe("used");
  });
  it("is expired at or after its expiry", () => {
    expect(inviteState({ acceptedAt: null, expiresAt: now }, now)).toBe("expired");
  });
});

describe("normalizeEmail and inviteLink", () => {
  it("lower-cases and trims a valid email", () => {
    expect(normalizeEmail("  Ali@Rudaw.NET ")).toBe("ali@rudaw.net");
  });
  it("rejects anything that is not an email", () => {
    expect(normalizeEmail("ali")).toBeNull();
    expect(normalizeEmail("a b@c.d")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@x.io`)).toBeNull();
  });
  it("builds the join link without a double slash", () => {
    expect(inviteLink("https://gituas.vercel.app/", "tok")).toBe("https://gituas.vercel.app/newsroom/join/tok");
  });
});
```

`tests/newsroom/team-limits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deskLimit, NEWS_LIMITS, seatsLeft } from "@/lib/billing/plans";

describe("seats", () => {
  it("counts members and live invites against the plan's seats", () => {
    expect(seatsLeft(5, 2, 1)).toBe(2);
    expect(seatsLeft(2, 2, 0)).toBe(0);
    expect(seatsLeft(2, 3, 1)).toBe(0);
  });
  it("gives each plan more seats than the last", () => {
    expect(NEWS_LIMITS.MANUAL.seats).toBe(2);
    expect(NEWS_LIMITS.AUTO.seats).toBe(5);
    expect(NEWS_LIMITS.ENTERPRISE.seats).toBeGreaterThan(NEWS_LIMITS.AUTO.seats);
  });
});

describe("deskLimit", () => {
  it("allows the manual plan's desks for someone who owns none", () => {
    expect(deskLimit([])).toBe(NEWS_LIMITS.MANUAL.desks);
  });
  it("uses the best plan among the desks already owned", () => {
    expect(deskLimit(["MANUAL", "AUTO"])).toBe(NEWS_LIMITS.AUTO.desks);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/newsroom/pick.test.ts tests/newsroom/invite.test.ts tests/newsroom/team-limits.test.ts`. They should FAIL.

- [ ] **Step 3: Implement.**

`src/lib/workspace/pick.ts`:

```ts
// Which workspace a person is acting in when they belong to several: the one
// their cookie names (only if it is still theirs), else their earliest claimed
// one, else their earliest. Claimed first, so an invitee's empty placeholder
// workspace never wins over the desk they joined.

export interface WorkspaceCandidate {
  id: string;
  kindChosen: boolean;
  joinedAt: Date;
}

export function pickWorkspace<T extends WorkspaceCandidate>(candidates: readonly T[], cookieId?: string | null): T | undefined {
  if (cookieId) {
    const chosen = candidates.find((c) => c.id === cookieId);
    if (chosen) return chosen;
  }
  const byAge = [...candidates].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return byAge.find((c) => c.kindChosen) ?? byAge[0];
}
```

`src/lib/newsroom/invite.ts`:

```ts
// Team invites. The link carries a random token; the database keeps only its
// SHA-256, so a leaked table cannot be used to join a desk.

import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITES_PER_DAY = 20;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export type InviteState = "ok" | "used" | "expired";

export function inviteState(invite: { acceptedAt: Date | null; expiresAt: Date }, now: Date = new Date()): InviteState {
  if (invite.acceptedAt) return "used";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "ok";
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/newsroom/join/${token}`;
}
```

Replace the **whole** `src/lib/billing/plans.ts` with the code below. The draft, improve, publish and sources numbers are unchanged; first confirm they match the current file, and keep the current numbers if they differ.

```ts
export type Metric = "draft" | "improve" | "publish";
export type Plan = "MANUAL" | "AUTO" | "ENTERPRISE";

/** Monthly quotas plus team size (seats, owner included) and desks a person may own. */
export const NEWS_LIMITS: Record<Plan, Record<Metric, number> & { sources: number; seats: number; desks: number }> = {
  MANUAL: { draft: 300, improve: 30, publish: 300, sources: 10, seats: 2, desks: 1 },
  AUTO: { draft: 3000, improve: 300, publish: 3000, sources: 30, seats: 5, desks: 3 },
  ENTERPRISE: { draft: 20000, improve: 2000, publish: 20000, sources: 100, seats: 1000, desks: 20 },
};

/** Seats still free: members and live invites both take one. */
export function seatsLeft(seats: number, members: number, pendingInvites: number): number {
  return Math.max(0, seats - members - pendingInvites);
}

/** Desks a person may own: the best plan among the desks they already own. */
export function deskLimit(ownedPlans: readonly Plan[]): number {
  return Math.max(NEWS_LIMITS.MANUAL.desks, ...ownedPlans.map((p) => NEWS_LIMITS[p].desks));
}
```

- [ ] **Step 4:** Run the three test files, which should PASS. Then run `npx vitest run` (all) and `npx tsc --noEmit`, both clean.
- [ ] **Step 5: Commit** with the message "Pick the active workspace, make invite tokens, and set team limits".

---

### Task 3: Invite table (controller runs this, since it touches the production database)

**Files:** Modify `prisma/schema.prisma`.

- [ ] **Step 1: Add the model** after `model Membership { … }`:

```prisma
/// A pending invitation into a workspace. Only the SHA-256 of the link's token
/// is stored; the row is kept after acceptance for the record.
model Invite {
  id          String         @id @default(cuid())
  tenantId    String
  email       String
  role        MembershipRole
  tokenHash   String         @unique
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime       @default(now())
  tenant      Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([email])
}
```

Also add `invites Invite[]` to `model Tenant`'s relation list, next to `memberships Membership[]`.

- [ ] **Step 2:** Run `npx prisma db push`. The change is additive, one new table, and it should report "Your database is now in sync". Then run `npx prisma generate`.
- [ ] **Step 3:** Run `npx tsc --noEmit`, which should be clean.
- [ ] **Step 4: Commit** `prisma/schema.prisma` with the message "Add the Invite table". `src/generated` is gitignored.

---

### Task 4: Membership-based workspace lookup, switching, new desks

**Files:**
- Modify `src/app/app/data.ts`.
- Create `src/app/newsroom/desk-actions.ts`.

- [ ] **Step 1: `data.ts` imports and type.**

Add these imports:

```ts
import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { pickWorkspace } from "@/lib/workspace/pick";
import type { Role } from "@/lib/newsroom/roles";
```

Add `role` to `Workspace`:

```ts
export interface Workspace {
  id: string;
  slug: string;
  name: string;
  whatsappNumber: string | null;
  kind: Kind;
  kindChosen: boolean;
  /** The signed-in person's role in this workspace. */
  role: Role;
}
```

- [ ] **Step 2: Replace `currentWorkspace`** (the whole function) with:

```ts
/** Names the workspace a person with several is working in; checked against their memberships on every read. */
export const WS_COOKIE = "gm_ws";

async function membershipsOf(userId: string) {
  return db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, createdAt: true, tenant: { select: WORKSPACE_SELECT } },
  });
}

/** Every workspace the signed-in person belongs to, oldest membership first. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return (await membershipsOf(session.user.id)).map((m) => ({ ...m.tenant, role: m.role }));
}

export async function currentWorkspace(): Promise<Workspace | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  let rows = await membershipsOf(userId);
  if (rows.length === 0) {
    // Every signed-in person gets a workspace, however they signed up.
    await ensureWorkspace(userId, session.user?.name);
    rows = await membershipsOf(userId);
  }
  const chosen = (await cookies()).get(WS_COOKIE)?.value;
  const picked = pickWorkspace(
    rows.map((m) => ({ id: m.tenant.id, kindChosen: m.tenant.kindChosen, joinedAt: m.createdAt })),
    chosen,
  );
  const row = rows.find((m) => m.tenant.id === picked?.id);
  return row ? { ...row.tenant, role: row.role } : null;
}

/** Remember which workspace to open. Call only from a server action or route handler. */
export async function rememberWorkspace(tenantId: string): Promise<void> {
  (await cookies()).set(WS_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** A new desk's starting settings: no keywords yet, and the GDELT source. */
export async function setupNewsDesk(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.newsSettings.upsert({ where: { tenantId }, create: { tenantId, keywords: [] }, update: {} });
  await tx.newsSource.upsert({
    where: { tenantId_catalogId: { tenantId, catalogId: "gdelt" } },
    create: { tenantId, catalogId: "gdelt", name: "GDELT" },
    update: {},
  });
}
```

- [ ] **Step 3: `claimKind`.**
  - Replace the inline `if (kind === "NEWS") { …newsSettings.upsert…newsSource.upsert… }` block with `if (kind === "NEWS") await setupNewsDesk(tx, ws.id);`.
  - Replace `return found ?? ws;` with `return found ? { ...found, role: ws.role } : ws;`.

  Everything else in `claimKind` stays the same.

- [ ] **Step 4: Create `src/app/newsroom/desk-actions.ts`:**

```ts
"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deskLimit } from "@/lib/billing/plans";
import { safeNext } from "@/lib/safe-next";
import { rememberWorkspace, setupNewsDesk } from "@/app/app/data";

/** Open another workspace the person belongs to. The id is checked against their memberships, never trusted. */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/newsroom/news");
  const id = String(formData.get("id") ?? "");
  const member = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: id, userId } },
    select: { tenant: { select: { kind: true } } },
  });
  if (!member) redirect("/newsroom/news");
  await rememberWorkspace(id);
  const home = member.tenant.kind === "NEWS" ? "/newsroom/news" : "/app";
  const next = safeNext(String(formData.get("next") ?? ""), home);
  redirect(/^\/(app|newsroom)(\/|\?|$)/.test(next) ? next : home);
}

export type DeskResult = { ok: false; error: string };

/** Create another newsroom desk (e.g. a second language) owned by the signed-in person, within their plan's desk limit. */
export async function createDeskAction(_prev: DeskResult | null, formData: FormData): Promise<DeskResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "دووبارە بچۆ ژوورەوە." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name || [...name].length > 60) return { ok: false, error: "ناوێک بۆ مێزەکە بنووسە، تا ٦٠ پیت." };

  const owned = await db.tenant.findMany({ where: { ownerId: userId, kind: "NEWS", kindChosen: true }, select: { plan: true } });
  if (owned.length >= deskLimit(owned.map((t) => t.plan))) {
    return { ok: false, error: "گەیشتیتە سنووری مێزەکانی پلانەکەت." };
  }

  const desk = await db.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name,
        slug: `d-${randomBytes(6).toString("hex")}`,
        ownerId: userId,
        kind: "NEWS",
        kindChosen: true,
        memberships: { create: { userId, role: "OWNER" } },
      },
      select: { id: true },
    });
    await setupNewsDesk(tx, t.id);
    await tx.auditLog.create({
      data: { tenantId: t.id, actor: "USER", action: "desk.created", reasoning: "Created a newsroom desk.", metadata: { userId } },
    });
    return t;
  });
  await rememberWorkspace(desk.id);
  redirect("/newsroom/news");
}
```

- [ ] **Step 5:** Run `npx tsc --noEmit`. Fix any error caused by `Workspace` now requiring `role`. Every place that builds a `Workspace` object by hand must carry `role` through. Don't loosen the type.
- [ ] **Step 6:** Run `npx vitest run`, which should pass.
- [ ] **Step 7: Commit** with the message "Find the workspace through memberships and let people switch or add desks".

---

### Task 5: Enforce roles on the server

**Files:**
- Modify `src/app/app/actions.ts`, `src/app/newsroom/(desk)/news/actions.ts`, `src/app/api/oauth/[provider]/start/route.ts` and `src/app/app/publish/page.tsx`.

- [ ] **Step 1: Shop and publish actions.** In `src/app/app/actions.ts`, add `import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";`.
  - In each action below, add a check immediately after the existing "no workspace" check. It returns the action's **own existing error shape** with `NOT_ALLOWED` as the message; for most that is `return { ok: false, error: NOT_ALLOWED };`. Read each action's return type and match it.

  | Action | Permission |
  |---|---|
  | `replyToCommentAction`, `setCommentHiddenAction`, `deleteCommentAction`, `sendMessageAction`, `draftReplyAction` | `"engage"` |
  | `suggestCaptionAction` | `"draft"` |
  | `saveWhatsAppAction` | `"configure"` |
  | `publishAction` | `"publish"` |
  | `changePasswordAction`, `tiktokContextAction`, `tiktokStatusAction` | no check (personal, or read-only) |

  The check is `if (!can(ws.role, "<permission>")) return …;`.

- [ ] **Step 2: News actions.** In `src/app/newsroom/(desk)/news/actions.ts`, import the same names. After each `newsWorkspace()` null check, add:

  | Action | Permission |
  |---|---|
  | `refreshNewsAction` | none |
  | `draftNewsAction`, `saveNewsDraftAction`, `attachCardAction`, `dismissNewsAction` | `"draft"` |
  | `saveKeywordsAction`, `toggleCatalogSourceAction`, `addRssSourceAction`, `removeSourceAction`, `saveBrandKitAction` | `"configure"` |

  `"draft"` is allowed for every role today. The check is still written, so a later change to the matrix is enforced everywhere. Use each action's own error shape.

- [ ] **Step 3: OAuth start.** In `src/app/api/oauth/[provider]/start/route.ts`:
  - Move the `returnTo` computation (the `next` / `returnTo` lines) above the tenant lookup.
  - Replace the `db.tenant.findFirst({ where: { ownerId } })` lookup with:

```ts
  // The shop and the newsroom connect pages to the workspace being worked in,
  // and only owners and editors may. The operator dashboard keeps its own tenant.
  let tenantId: string;
  if (/^\/(app|newsroom)(\/|$)/.test(returnTo)) {
    const ws = await currentWorkspace();
    if (!ws) return NextResponse.redirect(new URL("/login", req.url));
    if (!can(ws.role, "configure")) {
      const back = new URL(returnTo, req.url);
      back.searchParams.set("error", NOT_ALLOWED);
      return NextResponse.redirect(back);
    }
    tenantId = ws.id;
  } else {
    const tenant = await db.tenant.findFirst({ where: { ownerId: session.user.id }, select: { id: true } });
    if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });
    tenantId = tenant.id;
  }
```

  Then pass `tenantId` to `buildAuthorizeUrl`. Add the imports `currentWorkspace` (from `@/app/app/data`) and `can`, `NOT_ALLOWED` (from `@/lib/newsroom/roles`).

- [ ] **Step 4: Publish page for writers.** In `src/app/app/publish/page.tsx`, add `import { can } from "@/lib/newsroom/roles";`. Right after `const ws = (await currentWorkspace())!;`, add:

```tsx
  if (!can(ws.role, "publish")) {
    return (
      <p className="gm-note">
        تەنها خاوەن و سەرنووسەر دەتوانن بڵاو بکەنەوە. کارتەکە ئامادە بکە و سەرنووسەرەکەت ئاگادار بکەرەوە.
      </p>
    );
  }
```

- [ ] **Step 5:** Run `npx tsc --noEmit` and `npx vitest run`; both should be clean.
- [ ] **Step 6: Commit** with the message "Check the person's role in every action that publishes, replies or configures".

---

### Task 6: Invite email and the team screen

**Files:**
- Modify `src/lib/mailer.ts`.
- Create `src/app/newsroom/(desk)/team/actions.ts`, `team-client.tsx` and `page.tsx`.

- [ ] **Step 1: `inviteEmail`.** Append to `src/lib/mailer.ts`:

```ts
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** An invitation into a newsroom desk. Desk and inviter names are user text, so they are escaped. */
export function inviteEmail(input: { desk: string; inviter: string; role: string; link: string }): { subject: string; text: string; html: string } {
  const { desk, inviter, role, link } = input;
  const lead = `${inviter} بانگهێشتی کردوویت بۆ مێزی هەواڵی «${desk}» وەک ${role}.`;
  const tail = "ئەم بەستەرە بۆ ٧ ڕۆژ کار دەکات. پێویستە بە هەمان ئیمەیڵ بچیتە ژوورەوە. ئەگەر چاوەڕێی ئەمە نەبوویت، پشتگوێی بخە.";
  return {
    subject: `بانگهێشت بۆ ${desk} — گیتواس نیوزڕووم`,
    text: `${lead}\n\n${link}\n\n${tail}`,
    html: `<!doctype html><html lang="ckb" dir="rtl"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:Tahoma,Arial,sans-serif;color:#1c1b19">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:right">
<p style="margin:0 0 6px;font-size:20px;font-weight:700">گیتواس نیوزڕووم</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.7">${esc(lead)}</p>
<p style="margin:0 0 20px;text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#1f4fd6;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">بچۆ ناو مێزەکە</a></p>
<p style="margin:0;font-size:13px;line-height:1.7;color:#6b6760">${esc(tail)}</p>
</div></body></html>`,
  };
}
```

- [ ] **Step 2: Team actions** in `src/app/newsroom/(desk)/team/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { currentWorkspace, type Workspace } from "@/app/app/data";
import { NEWS_LIMITS, seatsLeft } from "@/lib/billing/plans";
import { emailEnabled, inviteEmail, sendEmail } from "@/lib/mailer";
import { INVITE_TTL_MS, INVITES_PER_DAY, inviteLink, newInviteToken, normalizeEmail } from "@/lib/newsroom/invite";
import { can, isInvitableRole, OWNER_ONLY, ROLE_LABEL, type InvitableRole } from "@/lib/newsroom/roles";

export type TeamResult = { ok: true; link?: string; emailed?: boolean } | { ok: false; error: string };

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://gituas.vercel.app";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The current newsroom desk, only when the signed-in person owns it. */
async function ownedDesk(): Promise<Workspace | null> {
  const ws = await currentWorkspace();
  return ws && ws.kind === "NEWS" && can(ws.role, "team") ? ws : null;
}

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

/** Invites sent (or re-sent) in the last day — counted from the log, so replacing an invite can't dodge the cap. */
async function invitesToday(tenantId: string): Promise<number> {
  return db.auditLog.count({
    where: { tenantId, action: { in: ["member.invited", "member.reinvited"] }, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
  });
}

async function deliver(ws: Workspace, email: string, role: InvitableRole, token: string): Promise<{ link: string; emailed: boolean }> {
  const session = await auth();
  const inviter = session?.user?.name || session?.user?.email || "گیتواس";
  const link = inviteLink(APP_ORIGIN, token);
  const emailed = emailEnabled && (await sendEmail({ to: email, ...inviteEmail({ desk: ws.name, inviter, role: ROLE_LABEL[role], link }) })).ok;
  return { link, emailed };
}

export async function inviteMemberAction(input: { email: string; role: string }): Promise<TeamResult> {
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: OWNER_ONLY };
  const session = await auth();
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "ئیمەیڵەکە دروست نییە." };
  if (!isInvitableRole(input.role)) return { ok: false, error: "ڕۆڵەکە دروست نییە." };
  const role = input.role;
  const now = new Date();

  const [members, pending, sentToday, already, tenant] = await Promise.all([
    db.membership.count({ where: { tenantId: ws.id } }),
    db.invite.count({ where: { tenantId: ws.id, acceptedAt: null, expiresAt: { gt: now }, NOT: { email } } }),
    invitesToday(ws.id),
    db.membership.findFirst({ where: { tenantId: ws.id, user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
  ]);
  if (already) return { ok: false, error: "ئەم کەسە پێشتر لە تیمەکەدایە." };
  if (sentToday >= INVITES_PER_DAY) return { ok: false, error: "ئەمڕۆ بانگهێشتی زۆرت ناردووە. سبەی هەوڵ بدەرەوە." };
  if (seatsLeft(NEWS_LIMITS[tenant?.plan ?? "MANUAL"].seats, members, pending) === 0) {
    return { ok: false, error: "هەموو شوێنەکانی پلانەکەت پڕن." };
  }

  const { token, tokenHash } = newInviteToken();
  // One live invite per email and desk: a new one replaces the old.
  await db.$transaction([
    db.invite.deleteMany({ where: { tenantId: ws.id, email, acceptedAt: null } }),
    db.invite.create({
      data: { tenantId: ws.id, email, role, tokenHash, invitedById: session!.user!.id!, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) },
    }),
  ]);
  await audit(ws.id, "member.invited", `Invited ${email} as ${role}.`, { email, role });
  const sent = await deliver(ws, email, role, token);
  revalidatePath("/newsroom/team");
  return { ok: true, ...sent };
}

export async function resendInviteAction(inviteId: string): Promise<TeamResult> {
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: OWNER_ONLY };
  const invite = await db.invite.findFirst({ where: { id: inviteId, tenantId: ws.id, acceptedAt: null }, select: { id: true, email: true, role: true } });
  if (!invite || !isInvitableRole(invite.role)) return { ok: false, error: "بانگهێشتەکە نەدۆزرایەوە." };
  if ((await invitesToday(ws.id)) >= INVITES_PER_DAY) return { ok: false, error: "ئەمڕۆ بانگهێشتی زۆرت ناردووە. سبەی هەوڵ بدەرەوە." };
  const { token, tokenHash } = newInviteToken();
  await db.invite.update({ where: { id: invite.id }, data: { tokenHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
  await audit(ws.id, "member.reinvited", `Re-sent the invite to ${invite.email}.`, { email: invite.email });
  const sent = await deliver(ws, invite.email, invite.role, token);
  revalidatePath("/newsroom/team");
  return { ok: true, ...sent };
}

export async function revokeInviteAction(inviteId: string): Promise<TeamResult> {
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: OWNER_ONLY };
  const { count } = await db.invite.deleteMany({ where: { id: inviteId, tenantId: ws.id, acceptedAt: null } });
  if (count) await audit(ws.id, "member.invite_revoked", "Revoked an invite.", { inviteId });
  revalidatePath("/newsroom/team");
  return { ok: true };
}

export async function changeRoleAction(membershipId: string, role: string): Promise<TeamResult> {
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: OWNER_ONLY };
  if (!isInvitableRole(role)) return { ok: false, error: "ڕۆڵەکە دروست نییە." };
  const m = await db.membership.findFirst({ where: { id: membershipId, tenantId: ws.id }, select: { id: true, role: true, userId: true } });
  if (!m) return { ok: false, error: "ئەندامەکە نەدۆزرایەوە." };
  if (m.role === "OWNER") return { ok: false, error: "ڕۆڵی خاوەن ناگۆڕدرێت." };
  await db.membership.update({ where: { id: m.id }, data: { role } });
  await audit(ws.id, "member.role_changed", `Changed a member's role to ${role}.`, { userId: m.userId, from: m.role, to: role });
  revalidatePath("/newsroom/team");
  return { ok: true };
}

export async function removeMemberAction(membershipId: string): Promise<TeamResult> {
  const ws = await ownedDesk();
  if (!ws) return { ok: false, error: OWNER_ONLY };
  const m = await db.membership.findFirst({ where: { id: membershipId, tenantId: ws.id }, select: { id: true, role: true, userId: true } });
  if (!m) return { ok: false, error: "ئەندامەکە نەدۆزرایەوە." };
  if (m.role === "OWNER") return { ok: false, error: "خاوەنی مێزەکە لا نابرێت." };
  await db.membership.delete({ where: { id: m.id } });
  await audit(ws.id, "member.removed", "Removed a member.", { userId: m.userId, role: m.role });
  revalidatePath("/newsroom/team");
  return { ok: true };
}
```

- [ ] **Step 3: Team page** `src/app/newsroom/(desk)/team/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { currentWorkspace } from "@/app/app/data";
import { NEWS_LIMITS, seatsLeft } from "@/lib/billing/plans";
import { inviteState } from "@/lib/newsroom/invite";
import { can } from "@/lib/newsroom/roles";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const ws = (await currentWorkspace())!;
  if (ws.kind !== "NEWS") redirect("/newsroom");
  const now = new Date();
  const [members, invites, tenant] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: ws.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
    db.invite.findMany({
      where: { tenantId: ws.id, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
  ]);
  const live = invites.filter((i) => inviteState({ acceptedAt: null, expiresAt: i.expiresAt }, now) === "ok").length;
  const seats = NEWS_LIMITS[tenant?.plan ?? "MANUAL"].seats;

  return (
    <TeamClient
      canManage={can(ws.role, "team")}
      seats={seats}
      left={seatsLeft(seats, members.length, live)}
      members={members.map((m) => ({ id: m.id, name: m.user.name ?? "", email: m.user.email ?? "", role: m.role }))}
      invites={invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expired: inviteState({ acceptedAt: null, expiresAt: i.expiresAt }, now) === "expired",
      }))}
    />
  );
}
```

- [ ] **Step 4: Team client** `src/app/newsroom/(desk)/team/team-client.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { num } from "@/app/app/format";
import { INVITABLE_ROLES, ROLE_LABEL, type Role } from "@/lib/newsroom/roles";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  type TeamResult,
} from "./actions";

type Member = { id: string; name: string; email: string; role: Role };
type Invite = { id: string; email: string; role: Role; expired: boolean };

const ROLE_HELP: Record<Role, string> = {
  OWNER: "هەموو شتێک، لەوانە تیم و پلان.",
  ADMIN: "بڵاوکردنەوە، وەڵامی کۆمێنت و نامە، و ڕێکخستنی سەرچاوە و براند.",
  MEMBER: "هەواڵ و کارت ئامادە دەکات، بەڵام بڵاوی ناکاتەوە.",
};

export function TeamClient(props: { canManage: boolean; seats: number; left: number; members: Member[]; invites: Invite[] }) {
  const { canManage, seats, left, members, invites } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("MEMBER");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);

  function run(task: () => Promise<TeamResult>, done?: string) {
    setMsg(null);
    start(async () => {
      const r = await task();
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      if (r.link) setLink({ url: r.link, emailed: !!r.emailed });
      if (done) setMsg({ ok: true, text: done });
      router.refresh();
    });
  }

  return (
    <div className="gm-stack">
      <div className="gm-between">
        <h2 className="gm-title kufi">تیم</h2>
        <small className="gm-sub" style={{ margin: 0 }}>
          {num(seats - left)} / {num(seats)} شوێن
        </small>
      </div>

      <div className="gm-card">
        {(["OWNER", "ADMIN", "MEMBER"] as Role[]).map((r) => (
          <p key={r} style={{ margin: "4px 0" }}>
            <b>{ROLE_LABEL[r]}</b>: <span className="gm-sub">{ROLE_HELP[r]}</span>
          </p>
        ))}
      </div>

      {canManage && (
        <form
          className="gm-card gm-stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteMemberAction({ email, role }), "بانگهێشتەکە دروست کرا.");
          }}
        >
          <div className="gm-field">
            <label htmlFor="invite-email">ئیمەیڵ</label>
            <input id="invite-email" className="gm-input gm-ltr" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="gm-field">
            <label htmlFor="invite-role">ڕۆڵ</label>
            <select id="invite-role" className="gm-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="gm-btn" disabled={pending || !email || left === 0}>
            بانگهێشت بکە
          </button>
          {left === 0 && <p className="gm-hint">هەموو شوێنەکانی پلانەکەت پڕن.</p>}
        </form>
      )}

      {link && (
        <div className="gm-card gm-stack" role="status">
          <p style={{ margin: 0 }}>
            {link.emailed ? "ئیمەیڵ نێردرا. دەتوانیت بەستەرەکەش خۆت بنێریت:" : "ئیمەیڵ نەنێردرا. بەستەرەکە خۆت بنێرە، بۆ نموونە لە وەتسئەپ:"}
          </p>
          <input className="gm-input gm-ltr" dir="ltr" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="بەستەری بانگهێشت" />
          <button type="button" className="gm-btn quiet small" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setMsg({ ok: true, text: "کۆپی کرا." }))}>
            کۆپی بکە
          </button>
        </div>
      )}

      {msg && <p className={msg.ok ? "gm-ok" : "gm-err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      <h3 className="gm-sec">ئەندامەکان</h3>
      <div className="gm-card">
        {members.map((m) => (
          <div key={m.id} className="gm-target">
            <div>
              <p>{m.name || m.email}</p>
              <small className="gm-ltr" dir="ltr">{m.email}</small>
            </div>
            {canManage && m.role !== "OWNER" ? (
              <div className="gm-row" style={{ gap: 6 }}>
                <select
                  className="gm-input"
                  style={{ width: "auto" }}
                  aria-label={`ڕۆڵی ${m.name || m.email}`}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => run(() => changeRoleAction(m.id, e.target.value), "ڕۆڵەکە گۆڕدرا.")}
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="gm-btn quiet small"
                  disabled={pending}
                  onClick={() => confirm(`${m.name || m.email} لە تیمەکە لاببرێت؟`) && run(() => removeMemberAction(m.id), "لابرا.")}
                >
                  لابردن
                </button>
              </div>
            ) : (
              <span className="gm-badge ghost">{ROLE_LABEL[m.role]}</span>
            )}
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <>
          <h3 className="gm-sec">بانگهێشتە چاوەڕوانەکان</h3>
          <div className="gm-card">
            {invites.map((i) => (
              <div key={i.id} className="gm-target">
                <div>
                  <p className="gm-ltr" dir="ltr">{i.email}</p>
                  <small>
                    {ROLE_LABEL[i.role]} {i.expired && <span className="gm-badge warn">بەسەرچووە</span>}
                  </small>
                </div>
                {canManage && (
                  <div className="gm-row" style={{ gap: 6 }}>
                    <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => resendInviteAction(i.id), "دووبارە نێردرا.")}>
                      دووبارە بنێرە
                    </button>
                    <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => revokeInviteAction(i.id), "هەڵوەشێنرایەوە.")}>
                      هەڵوەشاندنەوە
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5:** Run `npx tsc --noEmit` and `npx vitest run`, both clean.
- [ ] **Step 6: Commit** with the message "Add the team screen: invite, re-send, revoke, change role, remove".

---

### Task 7: Accepting an invite

**Files:** Create `src/app/newsroom/join/[token]/actions.ts`, `join-client.tsx` and `page.tsx`.

- [ ] **Step 1: Action** `actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { rememberWorkspace } from "@/app/app/data";
import { hashInviteToken, inviteState } from "@/lib/newsroom/invite";

export type JoinResult = { ok: false; error: string };

const GONE = "ئەم بانگهێشتە چیتر کار ناکات.";

/** Join the desk once: only the invited, verified email, and the invite is consumed atomically. */
export async function acceptInviteAction(_prev: JoinResult | null, formData: FormData): Promise<JoinResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "سەرەتا بچۆ ژوورەوە." };
  const token = String(formData.get("token") ?? "");
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { id: true, tenantId: true, email: true, role: true, acceptedAt: true, expiresAt: true },
  });
  if (!invite || inviteState(invite) !== "ok") return { ok: false, error: GONE };
  const me = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (!me?.emailVerified || me.email?.toLowerCase() !== invite.email) {
    return { ok: false, error: "ئەم بانگهێشتە بۆ ئیمەیڵێکی ترە." };
  }

  const now = new Date();
  const joined = await db.$transaction(async (tx) => {
    const { count } = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (count === 0) return false;
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: invite.tenantId, userId } },
      create: { tenantId: invite.tenantId, userId, role: invite.role },
      update: {},
    });
    await tx.auditLog.create({
      data: { tenantId: invite.tenantId, actor: "USER", action: "member.joined", reasoning: "Accepted a team invite.", metadata: { userId, role: invite.role } },
    });
    return true;
  });
  if (!joined) return { ok: false, error: GONE };
  await rememberWorkspace(invite.tenantId);
  redirect("/newsroom/news");
}
```

- [ ] **Step 2: Client bits** `join-client.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { signOut } from "next-auth/react";

import { acceptInviteAction, type JoinResult } from "./actions";

export function JoinButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(acceptInviteAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="gm-btn block" disabled={pending}>
        {pending ? "چاوەڕێ بکە…" : "بچۆ ناو مێزەکە"}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}

export function SwitchAccountButton({ next }: { next: string }) {
  return (
    <button type="button" className="gm-btn quiet block" onClick={() => signOut({ callbackUrl: `/login?next=${encodeURIComponent(next)}` })}>
      بە هەژمارێکی تر بچۆ ژوورەوە
    </button>
  );
}
```

- [ ] **Step 3: Page** `page.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hashInviteToken, inviteState } from "@/lib/newsroom/invite";
import { ROLE_LABEL } from "@/lib/newsroom/roles";
import { NewsroomRoot } from "../../desk-shell";
import { JoinButton, SwitchAccountButton } from "./join-client";

export const metadata: Metadata = { title: "بانگهێشت — گیتواس نیوزڕووم", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <NewsroomRoot>
      <div className="gm-auth">
        <p className="nr-brand kufi" style={{ padding: 0 }}>
          <span className="nr-live" aria-hidden="true" />
          گیتواس نیوزڕووم
        </p>
        <div className="gm-card gm-stack" style={{ marginTop: 18 }}>
          {children}
        </div>
      </div>
    </NewsroomRoot>
  );
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { email: true, role: true, acceptedAt: true, expiresAt: true, tenant: { select: { name: true } } },
  });
  if (!invite) return <Frame><p style={{ margin: 0 }}>ئەم بانگهێشتە نەدۆزرایەوە یان هەڵوەشێنراوەتەوە.</p></Frame>;

  const state = inviteState(invite);
  if (state === "used") {
    return (
      <Frame>
        <p style={{ margin: 0 }}>ئەم بانگهێشتە پێشتر بەکارهاتووە.</p>
        <Link href="/newsroom/news" className="gm-btn block">بچۆ نیوزڕووم</Link>
      </Frame>
    );
  }
  if (state === "expired") {
    return <Frame><p style={{ margin: 0 }}>ئەم بانگهێشتە بەسەرچووە. داوای بانگهێشتێکی نوێ لە خاوەنی مێزەکە بکە.</p></Frame>;
  }

  const here = `/newsroom/join/${token}`;
  const intro = (
    <>
      <h1 className="gm-title kufi" style={{ margin: 0 }}>بانگهێشت بۆ «{invite.tenant.name}»</h1>
      <p className="gm-sub" style={{ margin: 0 }}>
        وەک {ROLE_LABEL[invite.role]} · <span className="gm-ltr" dir="ltr">{invite.email}</span>
      </p>
    </>
  );

  const session = await auth();
  if (!session?.user?.id) {
    return (
      <Frame>
        {intro}
        <Link href={`/login?next=${encodeURIComponent(here)}`} className="gm-btn block">بچۆ ژوورەوە</Link>
        <Link href={`/signup?next=${encodeURIComponent(here)}`} className="gm-btn quiet block">هەژمارێکی نوێ دروست بکە</Link>
        <p className="gm-hint" style={{ margin: 0 }}>بە هەمان ئیمەیڵی سەرەوە بچۆ ژوورەوە یان خۆت تۆمار بکە.</p>
      </Frame>
    );
  }

  const me = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true, emailVerified: true } });
  if (me?.email?.toLowerCase() !== invite.email) {
    return (
      <Frame>
        {intro}
        <p className="gm-note warn" style={{ margin: 0 }}>
          ئێستا بە <span className="gm-ltr" dir="ltr">{me?.email ?? "—"}</span> چوویتە ژوورەوە. ئەم بانگهێشتە بۆ ئیمەیڵێکی ترە.
        </p>
        <SwitchAccountButton next={here} />
      </Frame>
    );
  }
  if (!me.emailVerified) {
    return (
      <Frame>
        {intro}
        <p className="gm-note warn" style={{ margin: 0 }}>ئیمەیڵی ئەم هەژمارە پشتڕاست نەکراوەتەوە، بۆیە ناتوانێت بانگهێشت وەربگرێت.</p>
      </Frame>
    );
  }
  return (
    <Frame>
      {intro}
      <JoinButton token={token} />
    </Frame>
  );
}
```

- [ ] **Step 4:** Run `npx tsc --noEmit` and `npx vitest run`, both clean.
- [ ] **Step 5: Commit** with the message "Let an invited person join a desk with the invited email".

---

### Task 8: Desk switcher, new desk, and no dead ends between products

**Files:**
- Create `src/app/newsroom/desk-switcher.tsx`, `src/app/newsroom/(desk)/desks/new/page.tsx` and `new-desk-form.tsx`.
- Modify `desk-shell.tsx`, `newsroom.css`, `shop-notice.tsx`, `(desk)/layout.tsx` and `src/app/newsroom/page.tsx`.
- Modify `src/app/app/layout.tsx`.

- [ ] **Step 1: Switcher** `src/app/newsroom/desk-switcher.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";

import { switchWorkspaceAction } from "./desk-actions";

export type DeskOption = { id: string; name: string; role: string };

/** The desk name in the top bar opens a list of the person's desks and "new desk". */
export function DeskSwitcher({ currentId, currentName, desks }: { currentId: string; currentName: string; desks: DeskOption[] }) {
  return (
    <details className="nr-switch">
      <summary className="nr-desk" aria-label={`مێز: ${currentName} — گۆڕین`}>
        <h1 className="kufi">{currentName}</h1>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="nr-switch-menu">
        {desks.map((d) => (
          <form key={d.id} action={switchWorkspaceAction}>
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="next" value="/newsroom/news" />
            <button type="submit" className="nr-link" aria-current={d.id === currentId ? "true" : undefined}>
              {d.id === currentId ? <Check aria-hidden="true" /> : <span style={{ width: 18, flex: "none" }} aria-hidden="true" />}
              <span>{d.name}</span>
              <small className="nr-switch-role">{d.role}</small>
            </button>
          </form>
        ))}
        <Link href="/newsroom/desks/new" className="nr-link">
          <Plus aria-hidden="true" />
          مێزی نوێ
        </Link>
      </div>
    </details>
  );
}
```

- [ ] **Step 2: CSS.** Append to `src/app/newsroom/newsroom.css`:

```css
/* desk switcher */
.nr-switch { position: relative; min-width: 0; }
.nr-switch > summary { list-style: none; cursor: pointer; border-radius: 10px; padding: 4px 6px; margin: -4px -6px; }
.nr-switch > summary::-webkit-details-marker { display: none; }
.nr-switch > summary:hover { background: var(--raised); }
.nr-switch > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.nr-switch-menu { position: absolute; inset-inline-start: 0; top: calc(100% + 8px); z-index: 10; display: grid; gap: 2px;
  min-width: 240px; max-width: calc(100vw - 32px); padding: 6px; border-radius: 12px; background: var(--surface);
  border: 1px solid var(--line-soft); box-shadow: 0 10px 28px rgb(0 0 0 / 0.14); }
.nr-switch-role { margin-inline-start: auto; font-size: 11px; color: var(--faint); }
```

- [ ] **Step 3: Shell.** In `src/app/newsroom/desk-shell.tsx`:
  - Make `DeskShell` an `async` function.
  - Import `listWorkspaces` from `@/app/app/data`, `ROLE_LABEL` from `@/lib/newsroom/roles`, and `DeskSwitcher` from `./desk-switcher`.
  - Replace the `<header className="nr-top">…</header>` block with:

```tsx
          <header className="nr-top">
            <DeskSwitcher
              currentId={ws.id}
              currentName={ws.name}
              desks={desks.map((d) => ({ id: d.id, name: d.name, role: ROLE_LABEL[d.role] }))}
            />
            <div className="gm-row" style={{ gap: 8 }}>
              <span className="gm-badge ghost">{ROLE_LABEL[ws.role]}</span>
              <HelpLink />
            </div>
          </header>
```

  At the top of `DeskShell`, add `const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen);`.

- [ ] **Step 4: New desk page.**

`src/app/newsroom/(desk)/desks/new/new-desk-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { createDeskAction, type DeskResult } from "../../../desk-actions";

export function NewDeskForm() {
  const [state, action, pending] = useActionState<DeskResult | null, FormData>(createDeskAction, null);
  return (
    <form action={action} className="gm-card gm-stack">
      <div className="gm-field">
        <label htmlFor="desk-name">ناوی مێز</label>
        <input id="desk-name" name="name" className="gm-input" required maxLength={60} placeholder="بۆ نموونە: بەشی عەرەبی" />
      </div>
      <button type="submit" className="gm-btn" disabled={pending}>
        {pending ? "دروست دەکرێت…" : "مێزەکە دروست بکە"}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}
```

`src/app/newsroom/(desk)/desks/new/page.tsx`:

```tsx
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { num } from "@/app/app/format";
import { deskLimit } from "@/lib/billing/plans";
import { NewDeskForm } from "./new-desk-form";

export default async function NewDeskPage() {
  const session = await auth();
  const owned = await db.tenant.findMany({
    where: { ownerId: session!.user!.id!, kind: "NEWS", kindChosen: true },
    select: { plan: true },
  });
  const limit = deskLimit(owned.map((t) => t.plan));
  return (
    <div className="gm-stack">
      <h2 className="gm-title kufi">مێزی نوێ</h2>
      <p className="gm-sub" style={{ margin: 0 }}>
        مێزێکی جیا بۆ زمانێک، بەشێک یان براندێکی تری کەناڵەکەت. هەر مێزێک پەیج، سەرچاوە، براند و تیمی خۆی هەیە.
      </p>
      {owned.length >= limit ? (
        <p className="gm-note">
          پلانەکەت {num(limit)} مێزی تێدایە و هەمووی بەکارهاتووە. بۆ مێزی زیاتر پەیوەندیمان پێوە بکە.
        </p>
      ) : (
        <NewDeskForm />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Shop notice offers the person's desks.** Replace `src/app/newsroom/shop-notice.tsx` with:

```tsx
"use client";

import { signOut } from "next-auth/react";

import { switchWorkspaceAction } from "./desk-actions";

/** Shown when the workspace being worked in is a shop. Offers the person's desks if they have any. */
export function ShopNotice({ desks = [] }: { desks?: { id: string; name: string }[] }) {
  return (
    <div className="gm-auth">
      <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
      <div className="gm-card" style={{ marginTop: 18 }}>
        <p style={{ margin: 0 }}>
          {desks.length
            ? "ئێستا لە دووکانەکەتیت. مێزێکی هەواڵ هەڵبژێرە:"
            : "ئەم هەژمارە هەژماری دووکانێکە. بۆ نیوزڕووم، بە ئیمەیڵێکی تر خۆت تۆمار بکە."}
        </p>
      </div>
      {desks.map((d) => (
        <form key={d.id} action={switchWorkspaceAction}>
          <input type="hidden" name="id" value={d.id} />
          <input type="hidden" name="next" value="/newsroom/news" />
          <button type="submit" className="gm-btn block" style={{ marginTop: 10 }}>
            بچۆ «{d.name}»
          </button>
        </form>
      ))}
      <button
        type="button"
        className="gm-btn quiet block"
        style={{ marginTop: 12 }}
        onClick={() => signOut({ callbackUrl: "/login?next=/newsroom/news" })}
      >
        چوونەدەرەوە
      </button>
    </div>
  );
}
```

  Then, in `src/app/newsroom/(desk)/layout.tsx` and `src/app/newsroom/page.tsx`, where `<ShopNotice />` is rendered:
  - Import `listWorkspaces` from `@/app/app/data`.
  - Render `<ShopNotice desks={(await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen).map((w) => ({ id: w.id, name: w.name }))} />`. Compute the list into a `const` first for readability.

- [ ] **Step 6: The shop doesn't strand someone whose active workspace is a desk.** In `src/app/app/layout.tsx`:
  - Import `listWorkspaces`, and `switchWorkspaceAction` from `@/app/newsroom/desk-actions`.
  - Replace `if (ws.kind === "NEWS") redirect("/newsroom/news");` with:

```tsx
  if (ws.kind === "NEWS") {
    const shops = (await listWorkspaces()).filter((w) => w.kind === "MERCHANT" && w.kindChosen);
    if (shops.length === 0) redirect("/newsroom/news");
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <div className="gm-auth">
          <p className="gm-brand kufi">گیتواس</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>ئێستا لە مێزی هەواڵی «{ws.name}»یت.</p>
          </div>
          {shops.map((s) => (
            <form key={s.id} action={switchWorkspaceAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="next" value="/app" />
              <button type="submit" className="gm-btn block" style={{ marginTop: 10 }}>
                بچۆ دووکانی «{s.name}»
              </button>
            </form>
          ))}
          <Link href="/newsroom/news" className="gm-btn quiet block" style={{ marginTop: 10 }}>
            بگەڕێوە بۆ نیوزڕووم
          </Link>
        </div>
      </div>
    );
  }
```

- [ ] **Step 7:** Run `npx tsc --noEmit`, `npx vitest run` and `npx next build`, all clean. If the build changes `package-lock.json`, revert it with `git checkout package-lock.json`.
- [ ] **Step 8: Commit** with the message "Switch desks from the top bar, create desks, and switch instead of dead-ending between products".

---

### Task 9: Nav, guide, landing

**Files:**
- Modify `src/lib/newsroom/nav.ts`, `src/lib/newsroom/guide.ts`, `src/app/newsroom/desk-nav.tsx` and `src/app/newsroom/page.tsx`.

- [ ] **Step 1: Nav.**
  - In `nav.ts`, add `"team"` to `NavKey`.
  - Insert this entry just before the `settings` entry:

```ts
  { key: "team", href: "/newsroom/team", label: "تیم", group: "account", mobile: false, guide: "team" },
```

  In `desk-nav.tsx`, import `Users` from lucide-react and add `team: Users` to `ICONS`.

- [ ] **Step 2: Guide.**
  - In `guide.ts`, insert `"team"` into `GUIDE_IDS` between `"insights"` and `"faq"`.
  - Insert this section in `GUIDE` between the `insights` and `faq` sections:

```ts
  {
    id: "team",
    title: "تیم و ڕۆڵەکان",
    intro: "هاوکارەکانت بانگهێشت بکە. ڕۆڵی هەر کەسێک دیاری دەکات چی دەتوانێت بکات.",
    steps: [
      "«خاوەن»: هەموو شتێک، لەوانە تیم و پلان.",
      "«سەرنووسەر»: بڵاوکردنەوە، وەڵامی کۆمێنت و نامە، و ڕێکخستنی سەرچاوە و براند.",
      "«نووسەر»: هەواڵ و کارت ئامادە دەکات، بەڵام بڵاوی ناکاتەوە.",
      "لە «تیم»، ئیمەیڵ و ڕۆڵ بنووسە و «بانگهێشت بکە» دابگرە. بەستەرەکە بە ئیمەیڵ دەنێردرێت و دەتوانیت خۆشت کۆپی بکەیت و بینێریت.",
      "بانگهێشتکراو دەبێت بە هەمان ئیمەیڵ بچێتە ژوورەوە. بەستەرەکە ٧ ڕۆژ کار دەکات.",
      "بۆ مێزێکی تر، بۆ نموونە بەشی عەرەبی، لە سەرەوە ناوی مێزەکە دابگرە و «مێزی نوێ» هەڵبژێرە.",
    ],
    link: { href: "/newsroom/team", label: "بچۆ تیم" },
  },
```

- [ ] **Step 3: Landing.** In `src/app/newsroom/page.tsx`, import `Users` from lucide-react and append this item to `FEATURES`:

```ts
  {
    Icon: Users,
    title: "تیمەکەت پێکەوە",
    body: "نووسەر، سەرنووسەر و خاوەن، هەر یەکە بە ڕۆڵی خۆی. چەند مێز بۆ چەند زمان یان براند.",
  },
```

- [ ] **Step 4:** Run `npx vitest run`. The nav test must still find exactly 4 phone items and a guide section for every item. Then run `npx tsc --noEmit`.
- [ ] **Step 5: Commit** with the message "Add the team section to the nav, the guide and the landing page".

---

### Task 10: Verify and ship (controller)

- [ ] Run `npx vitest run`, `npx tsc --noEmit` and `npm run build`.
- [ ] Create the local test writer: a user `newsroom-writer@gituas.app` with `emailVerified` set and a random password. Write the password to `gituas-private/test-accounts.md` only. The user has no workspace yet, so `ensureWorkspace` makes their placeholder on first open, which is the realistic path.
- [ ] On localhost (`gituas-dev`), check:
  - **As owner:** `/newsroom/team` → invite the writer as نووسەر → the link is shown.
  - **As writer:**
    - open the link → join → land in the owner's desk with the نووسەر badge;
    - `/newsroom/publish` shows the notice;
    - saving keywords in settings fails with the role message.
  - **Switcher:** the writer creates their own desk; the switcher lists both; switching works.
  - **As owner:** change the writer to سەرنووسەر, then remove them.
  - `/app` for the writer does not strand them.
- [ ] Update `TODOS.md`, fast-forward `master`, push, and check the production pages while signed out.
