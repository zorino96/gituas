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
1. ✅ Create App wizard opened; name **Gituas** typed; ⏳ user types contact email
2. ⏳ Next → use case **Other** → type **Business** → Create app
3. ⏳ Dashboard → Add product → **Instagram** → Set up
4. ⏳ Instagram → **API setup with Instagram business login** (NOT Facebook login)
5. ⏳ §1 Generate access tokens → **Add account** (log in with your IG professional account = dev/test account)
6. ⏳ §3 Business login settings → **OAuth redirect URIs** = `https://gituas.vercel.app/api/oauth/meta_instagram/callback`
7. ⏳ Copy **Instagram app ID + secret** (from the API-setup page — NOT Settings>Basic!) → Vercel env `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` → redeploy
8. ⏳ App settings → Basic: icon 1024 (`public/brand/gituas-icon-1024.png`), category, Privacy `https://gituas.vercel.app/privacy`, **Data deletion request URL** = `https://gituas.vercel.app/api/meta/data-deletion`
9. ⏳ Test in dev mode: connect IG account on gituas.vercel.app → approve a post → Reel appears (role-holders publish for real; up to 50 testers via App roles → Instagram Tester)
10. ⏳ App review → request Advanced Access for the 2 scopes + **Business Verification** + screencast per scope + reviewer instructions (need ≥1 successful API call per scope in last 30 days)

## ⚠️ Gotchas (from verified research)
- TWO id/secret pairs: use the **Instagram** pair from API-setup, not the Meta app pair.
- Token exchange response is wrapped in `data[]`; short token lives **1 hour**; long-lived 60d; refresh only when ≥24h old and NOT expired (expired = re-auth).
- Redirect gets a literal `#_` appended — harmless (fragment).
- Reels specs: MP4 H.264/AAC, moov-front (`-movflags +faststart`), ≤1920px wide, 9:16, 3s–15min. `media_type` REELS/STORIES/CAROUSEL only.
- Quota: ~100 posts/24h/account (read `config.quota_total` at runtime). FB Pages (phase 2): 30/24h.
- Personal IG accounts cannot connect — professional (business/creator) only.
- Review: Business Verification mandatory for Advanced Access; 2–4 weeks typical; dev-mode testers are the bridge (like the TikTok sandbox).
- Later scopes for the reply-agent (separate submission, after v1 approval): `instagram_business_manage_comments`, `instagram_business_manage_messages`.
