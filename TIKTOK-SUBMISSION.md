# Gituas — TikTok App Submission (resume sheet)

**App:** Gituas (Production) → https://developers.tiktok.com/app/7648797513306310664/pending
**Status:** Draft filled in-browser but **NOT saved** — TikTok blocks Save/Submit until a demo video is uploaded, so every form field below is volatile and lost on reload. The values here let us re-fill in ~5 min, then submit.

---

## ✅ Saved on the server (do NOT redo)
- **Vercel deploy:** https://gituas.vercel.app (production, public)
- **Domain verified** in TikTok "URL properties" → prefix `https://gituas.vercel.app/`
  - Signature file: `public/tiktokVuAukhtOy3WXAbWGX9nVnnxGGgOj5zPW.txt` — **keep it deployed**.
- **Legal pages:** `/terms`, `/privacy`, `/data-deletion`
- `NEXT_PUBLIC_APP_URL` (Vercel) = `https://gituas.vercel.app`

---

## 📋 App details — copy/paste to re-fill
| Field | Value |
|---|---|
| App icon | upload `public/brand/gituas-icon-1024.png` (1024×1024) — **you must do this, I can't upload** |
| App name | `Gituas` |
| Category | `Others` |
| Description (≤120) | `Gituas auto-creates and publishes marketing videos to your TikTok, so indie makers grow while they sleep.` |
| Terms of Service URL | `https://gituas.vercel.app/terms` |
| Privacy Policy URL | `https://gituas.vercel.app/privacy` |
| Web/Desktop URL | `https://gituas.vercel.app/`  ← **trailing slash** (must match verified prefix) |
| Platforms | **Web only** |

## 🧩 Products & Scopes (exact how-to — learned, repeatable)
1. Products → **Add Login Kit FIRST** (Content Posting API is greyed until Login Kit is added).
2. Products → **Add Content Posting API**.
3. In **Content Posting API** card: `video.upload` is ON by default ("Upload to TikTok"). **Turn ON the "Direct Post" toggle** → adds `video.publish`.
   - "Verify domains" = only for `pull_by_url`. We use `push_by_file`, so **skip it**.
4. **Login Kit → "Configure for Web"** → add Redirect URI: `https://gituas.vercel.app/api/oauth/tiktok/callback`
5. Resulting scopes (auto, shown in App review): `user.info.basic`, `video.upload`, `video.publish`.
   - NOTE: the generic "Add scopes" picker does NOT list the video scopes — they come from the product toggles above.

## ✍️ App review — "Explain how each product and scope works" (paste verbatim)
```
Gituas is a web app that automates TikTok marketing for indie software makers.

user.info.basic: after the creator authorizes Gituas, we fetch their open ID, display name and avatar via /v2/user/info/. We show the creator's username and avatar on the publish screen so they always confirm which account a post will go to.

video.upload & video.publish (Content Posting API, Direct Post): the creator approves a short marketing video created in Gituas; we then upload it to their TikTok account and publish it to their profile. Every post is reviewed and approved by the creator before it goes live - Gituas never posts without explicit authorization.

We request only these scopes, store all tokens encrypted, and use the data solely to publish content the creator approves.
```

---

## ⛔ The only real blocker: the demo video
**"Upload at least one demo video that shows the complete end-to-end flow."**
- Must be recorded in **Sandbox** (app not approved before).
- Must demonstrate each scope: login (username+avatar), `video.upload`, `video.publish` (Direct Post).
- Domain shown in the video must be `gituas.vercel.app`. Show real UI. ≤5 files, ≤50 MB each.
- ⚠️ **The TikTok publisher in Gituas is currently a STUB.** A valid video needs the real TikTok OAuth + Content Posting (Direct Post) flow actually working — that's a dev task to do first.

## 🔒 TikTok hard rules to build into the app
- Display creator **username + avatar before every post** (verified in review).
- Public posting needs the **audit**; until audited → `SELF_ONLY`, max 5 users / 24h.

## ✅ Integration BUILT & deployed (2026-06-10)
Real TikTok OAuth (Login Kit) + Content Posting **Direct Post** is live in code:
- `src/lib/oauth/registry.ts` + `flow.ts` — TikTok OAuth (`client_key`, PKCE), stores token + creator avatar.
- `src/lib/publishers/tiktok.ts` — `creator_info` query → Direct Post init (`PULL_FROM_URL`, `SELF_ONLY` until audited).
- Integrations UI shows the connected TikTok **username + avatar** (TikTok's hard rule).
- DB column `avatarUrl` added (Neon synced).

## 🔧 To RUN it (so you can record the demo) — your steps
1. **Vercel env:** add `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` (TikTok app → Credentials) → redeploy.
2. **TikTok → Login Kit → Configure for Web → Redirect URI:** `https://gituas.vercel.app/api/oauth/tiktok/callback`
3. **Sandbox:** TikTok app → Sandbox → same products/scopes + add your TikTok account as a **target user**; use the sandbox key/secret in Vercel for the recording.
4. **Sample video:** put a short MP4 at `public/demo/sample.mp4` → `https://gituas.vercel.app/demo/sample.mp4` (verified domain). A ContentPost's `sourceAssetUrl` must point to it.
5. **Record:** gituas.vercel.app → Dashboard → Integrations → connect TikTok (shows username+avatar) → approve a post → posts SELF_ONLY → screencast the whole flow.

## ▶️ Then submit
1. Re-open the form → re-fill App details (table above) + re-upload icon.
2. Re-add Products + Scopes + Direct Post + Redirect URI.
3. Paste the App-review explanation.
4. Upload the demo video.
5. **Submit for review.**
