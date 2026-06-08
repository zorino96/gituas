# Gituas — TikTok App Submission (resume sheet)

**App:** Gituas (Production) → https://developers.tiktok.com/app/7648797513306310664/pending
**Status (2026-06-09):** Draft filled in-browser but **NOT saved** — TikTok blocks Save/Submit until a demo video is uploaded. Re-enter the values below tomorrow, then submit.

---

## ✅ Already done & PERSISTED on the server (do NOT redo)
- **Deployed to Vercel:** https://gituas.vercel.app (production, public)
- **Domain verified** in TikTok "URL properties" → URL prefix `https://gituas.vercel.app/`
  - Verified via signature file: `public/tiktokVuAukhtOy3WXAbWGX9nVnnxGGgOj5zPW.txt`
  - ⚠️ **Keep that file deployed** (don't delete) or the verification breaks.
- **Legal pages live:** `/terms`, `/privacy`, `/data-deletion`
- `NEXT_PUBLIC_APP_URL` on Vercel = `https://gituas.vercel.app`

---

## 📋 Form field values — copy/paste to re-fill tomorrow
| Field | Value |
|---|---|
| App icon | `public/brand/gituas-icon-1024.png` (1024×1024) |
| App name | `Gituas` |
| Category | `Others` |
| Description (≤120) | `Gituas auto-creates and publishes marketing videos to your TikTok, so indie makers grow while they sleep.` |
| Terms of Service URL | `https://gituas.vercel.app/terms` |
| Privacy Policy URL | `https://gituas.vercel.app/privacy` |
| Web/Desktop URL | `https://gituas.vercel.app/`  ← **trailing slash required** (must match verified prefix) |
| Platforms | **Web only** (uncheck Desktop/Android/iOS) |

### "Explain how each product and scope works" (paste verbatim)
```
Gituas is a web app that automates TikTok marketing for indie software makers.

user.info.basic: after the creator authorizes Gituas, we fetch their open ID, display name and avatar via /v2/user/info/. We show the creator's username and avatar on the publish screen so they always confirm which account a post will go to.

video.upload & video.publish (Content Posting API, Direct Post): the creator approves a short marketing video created in Gituas; we then upload it to their TikTok account and publish it to their profile. Every post is reviewed and approved by the creator before it goes live - Gituas never posts without explicit authorization.

We request only these scopes, store all tokens encrypted, and use the data solely to publish content the creator approves.
```

---

## ⏳ Remaining steps (tomorrow)
1. **Add Products:** Login Kit + Content Posting API
2. **Add Scopes:** `user.info.basic`, `video.upload`, `video.publish`
3. **Upload the demo video** (the blocker — see below)
4. **Submit for review**

## 🎬 Demo video requirements (what to record)
- Record the integration working in **Sandbox** (app not approved before → sandbox is required).
- Demonstrate **each scope**: login showing username+avatar (`user.info.basic`), uploading a video (`video.upload`), publishing via Direct Post (`video.publish`).
- Show the website where it integrates; the **domain in the video must be `gituas.vercel.app`**.
- Show real UI + user interactions. Max 5 files, ≤50 MB each.
- ⚠️ **Reality check:** the TikTok publisher in Gituas is currently a **stub**. For the video to pass review, the real TikTok OAuth + Content Posting (Direct Post) flow must actually work. That's a dev task to do before/while recording.

## 🔒 TikTok hard rules to bake into the app
- Must display creator **username + avatar before every post** (verified during review).
- Public posting needs the **app audit**; until audited, posts are `SELF_ONLY`, max 5 users / 24h.
