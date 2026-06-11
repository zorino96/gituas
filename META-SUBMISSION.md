# Gituas — Meta / Instagram Submission (resume sheet)

**Setup chosen:** "Instagram API with Instagram Login" (business login) — **no Facebook Page needed**, no domain verification for `video_url`. Clients log in with their Instagram **professional** (business/creator) account. Facebook Page publishing = phase 2 (`META_FACEBOOK`, still stubbed).

## ✅ Code DONE (2026-06-10, deployed)
- `src/lib/oauth/registry.ts` — META_INSTAGRAM live config: scopes `instagram_business_basic, instagram_business_content_publish`, authorize `www.instagram.com/oauth/authorize`, token `api.instagram.com/oauth/access_token`, env `INSTAGRAM_APP_ID/SECRET`. META_FACEBOOK rescoped + kept blocked (phase 2).
- `src/lib/oauth/flow.ts` — IG branch: comma scopes; code→1h token (unwraps `{"data":[...]}` shape!) → immediate 60-day exchange (`graph.instagram.com/access_token?grant_type=ig_exchange_token`); `/v25.0/me` for @username+avatar; `providerUserId` fallback. providerAccountId = **IG_USER_ID** (used in all publish calls).
- `src/lib/publishers/instagram.ts` — Reels: lazy token refresh (<10d to expiry, no refresh_token — token refreshes itself), quota pre-check (`content_publishing_limit`), container `POST /{IG_USER_ID}/media` (REELS, video_url, caption≤2200, share_to_feed), poll `status_code` ≤45s, `media_publish`, permalink. Host = `graph.instagram.com` (NOT graph.facebook.com).
- `src/lib/publishers/index.ts` — META_INSTAGRAM wired (caption = description + #hashtags, video = sourceAssetUrl).
- `src/app/api/meta/data-deletion/route.ts` — signed_request HMAC verify → deletes IG credentials → `{url, confirmation_code}`. Configure as "Data deletion request URL".
- `approvals/page.tsx` — `maxDuration = 60` for the publish poll.

## 📋 Dashboard steps (developers.facebook.com) — where we are
1. ✅ App **Gituas** created (App ID `1679071989875234`, type Business)
2. ✅ Instagram product → **API setup with Instagram business login**; Instagram App ID `1882340945784789`
3. ✅ §3 Business login → redirect `https://gituas.vercel.app/api/oauth/meta_instagram/callback` + data-deletion URL set
4. ✅ Vercel env `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` set; deployed
5. ✅ Tester `rwbn2026` added (App roles → Instagram Tester) + invite accepted → connected on gituas.vercel.app (token live, 60d)
6. ✅ **App attached to verified business `Bangasha` (ID `686901398891438`)** → App settings → Basic shows **Business verification: Verified** AND **Access verification: Verified (Tech Provider)** — both inherited, no documents re-submitted
7. ⏳ App settings → Basic: add **Privacy** `https://gituas.vercel.app/privacy` + **Terms** `https://gituas.vercel.app/terms` (icon ✅ moon, category ✅ Business and pages)
8. ⏳ Configure **Webhooks** (Instagram product): callback `https://gituas.vercel.app/api/meta/webhooks`, verify token = env `META_WEBHOOK_VERIFY_TOKEN`; subscribe `comments` + `messages`
9. ⏳ Phase 1 App Review (below)

---

## 🗺️ MASTER PERMISSION PLAN (from 21-agent research, 2026-06-11)

**Product strategy — run BOTH routes:** keep **Instagram API with Instagram Login** (graph.instagram.com, `instagram_business_*`, no FB Page) as the organic engine; add **Marketing API** (Facebook Login for Business) for ads/boost. Defer the Facebook-Login Instagram route (only needed for hashtag search / business discovery / shopping tags).

**Phase 0 — approved/live:** `instagram_business_basic`, `instagram_business_content_publish`
**Phase 1 — submit FIRST (one batch, all on the existing token):**
`instagram_business_manage_comments` · `instagram_business_manage_insights` · `instagram_business_manage_messages`
**Phase 2 — Marketing API (separate, heavier review):** `ads_management` · `ads_read` · `business_management` (+ customer must Add-Partner ad-account/Page access; prefer System User tokens)
**Phase 3 — only if needed:** Facebook-Login IG route + Pages scopes.

**⚠️ Verifier corrections (don't repeat the stale-doc mistakes):**
- Instagram-Login route uses the `instagram_business_*` names — NOT `instagram_manage_*` (those are the Facebook-Login route).
- `instagram_business_manage_insights` DOES work on the Instagram-Login route (overview comparison table is stale).
- `pages_manage_metadata` is NOT needed on the Instagram-Login route.
- Every scope needs **Advanced Access** (we serve non-role accounts); verified Tech Provider does NOT auto-grant any scope.

**⚠️ Messaging policy (heavy review):** reply only to users who message first; free-form only inside the 24h window; `HUMAN_AGENT` is forbidden for automated/AI replies; disclose automation + offer a human path.
**⚠️ Ads:** ad-account access is off-OAuth (customer Add-Partner). Keep `requireApproval` + per-tenant budget caps before real spend.
**⚠️ Legal:** privacy + data-deletion already extended for comments/DMs/insights (commit pending) — required before submitting the messaging/insights review.

**Code shipped for Phase 1 (this session):**
- `registry.ts` META_INSTAGRAM scopes → all 5
- `publishers/instagram.ts` → IMAGE/VIDEO(REELS)/STORY containers (was Reels-only) + exported `getIgCred`
- `publishers/instagram-engage.ts` (NEW) → comments (fetch/reply/hide), DMs (send), insights (user/media)
- `publishers/reply-sender.ts` (NEW) + `reply-agent.ts` → actually sends IG comment/DM replies
- `app/api/meta/webhooks/route.ts` (NEW) → verify handshake + ingest inbound comments/DMs → ConversationMessage
- privacy page → IG/Meta section + engagement/insights disclosures; `.env.example` → `META_WEBHOOK_VERIFY_TOKEN`

**Phase 1 review checklist (per scope: 1 successful API call in last 30d + use-case text + screencast):**
- comments: screencast reading a comment + posting a reply (+ hide)
- insights: screencast pulling account/media insights into the dashboard
- messages: screencast receiving a DM + sending a reply within 24h

## ⚠️ Gotchas (from verified research)
- TWO id/secret pairs: use the **Instagram** pair from API-setup, not the Meta app pair.
- Token exchange response is wrapped in `data[]`; short token lives **1 hour**; long-lived 60d; refresh only when ≥24h old and NOT expired (expired = re-auth).
- Redirect gets a literal `#_` appended — harmless (fragment).
- Reels specs: MP4 H.264/AAC, moov-front (`-movflags +faststart`), ≤1920px wide, 9:16, 3s–15min. `media_type` REELS/STORIES/CAROUSEL only.
- Quota: ~100 posts/24h/account (read `config.quota_total` at runtime). FB Pages (phase 2): 30/24h.
- Personal IG accounts cannot connect — professional (business/creator) only.
- Review: Business Verification mandatory for Advanced Access; 2–4 weeks typical; dev-mode testers are the bridge (like the TikTok sandbox).
- Later scopes for the reply-agent (separate submission, after v1 approval): `instagram_business_manage_comments`, `instagram_business_manage_messages`.
