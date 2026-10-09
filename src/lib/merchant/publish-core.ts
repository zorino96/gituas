// Publishing, without a session. The composer's server action authenticates and
// then calls publishForWorkspace; the scheduled-post cron route calls it with no
// session at all, so nothing in here may read cookies, headers or the current
// user. Everything it needs comes in through `ws` and `input`.

import { loadAccountLists } from "@/app/app/data";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { withAccounts } from "@/lib/oauth/account-scope";
import { assertWithin, LimitReached, limitMessage, newsroomFrozenError } from "@/lib/billing/limits";
import { ckb, type Dict } from "@/lib/i18n/ckb";
import { captionProblems, isJpegPath, isKnownTarget, isOwnBlobUrl, isOwnPathname, youtubeOptionProblems, youtubeProblem, type Target, type YouTubeOptions } from "@/lib/merchant/caption";
import { tiktokProblems } from "@/lib/merchant/tiktok-rules";
import { recordNewsPublish } from "@/lib/news/publish-record";
import { checkDraft } from "@/lib/news/rules";
import type { Role } from "@/lib/newsroom/roles";
import { publishToFacebookPage } from "@/lib/publishers/facebook";
import { publishToInstagram } from "@/lib/publishers/instagram";
import { parkInstagramContainer } from "@/lib/publishers/instagram-finish";
import { publishToYouTube } from "@/lib/publishers/youtube";
import { getTikTokPostContext, publishPhotoToTikTok, publishToTikTok } from "@/lib/publishers/tiktok";
import { tagPublishedPost } from "@/lib/shop/state";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://gituas.vercel.app";

/** The connection provider behind each publish target. */
const TARGET_PROVIDER = { FB: "META_FACEBOOK", IG: "META_INSTAGRAM", TT: "TIKTOK", YT: "YOUTUBE" } as const satisfies Record<Target, string>;

export interface PublishInput {
  caption: string;
  targets: Target[];
  media?: { url: string; pathname: string; type: "IMAGE" | "VIDEO"; durationSec?: number };
  /** Set when the post comes from the news desk; its result is recorded on the draft. */
  newsDraftId?: string;
  /** A shop product card: the published Facebook/Instagram post is tagged with it, so price questions get its card. */
  productId?: string;
  /**
   * The longest the Instagram part may take, in milliseconds. Only the autopilot sets it, because
   * it runs inside a background tick with a hard limit; a person's own post waits as it always did.
   */
  igDeadlineMs?: number;
  /** The title, description and privacy the person set for YouTube. Older scheduled posts have none and use the caption. */
  youtube?: YouTubeOptions;
  /**
   * The accounts to publish to, per platform, when the workspace has several (account ids as stored
   * on the connection). A platform without a list uses its default connection; TikTok takes one.
   */
  accounts?: Partial<Record<Target, string[]>>;
  tiktok?: {
    privacy: string | null;
    allowComment: boolean;
    allowDuet: boolean;
    allowStitch: boolean;
    commercial: boolean;
    yourBrand: boolean;
    branded: boolean;
  };
}

export interface PublishOutcome {
  target: Target;
  /** The account it went to, when one was chosen. */
  accountId?: string;
  /** Instagram: still processing; published automatically within minutes (src/lib/publishers/instagram-finish.ts). */
  pending?: boolean;
  accountName?: string;
  ok: boolean;
  url?: string;
  publishId?: string;
  /** The platform's id for the published post (Facebook, Instagram and YouTube). */
  externalId?: string;
  error?: string;
}

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject = {}) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

/**
 * Publish one post to every selected platform. Each target succeeds or fails on
 * its own — a TikTok rejection never hides that Instagram went out. TikTok's
 * rules are re-checked here against a fresh creator_info call, never against
 * what the browser sent; publishToTikTok checks them a third time.
 *
 * The caller has already authenticated and checked the "publish" permission. `t` words the
 * errors; the cron route and the autopilot have no viewer, so they get Sorani.
 */
export async function publishForWorkspace(
  ws: { id: string; kind: "MERCHANT" | "NEWS"; role: Role },
  input: PublishInput,
  t: Dict = ckb,
): Promise<PublishOutcome[] | { error: string }> {
  const m = t.actions.publish;
  const targets = [...new Set(input.targets)];
  if (!targets.length) return { error: t.publish.blockPickTarget };
  if (!targets.every(isKnownTarget)) return { error: m.unknownTarget };
  // A frozen newsroom may not post at all — not only drafts from the news desk.
  if (ws.kind === "NEWS") {
    const frozen = await newsroomFrozenError(ws.id, t.nr.news.actions);
    if (frozen) return { error: frozen };
  }
  if (input.newsDraftId) {
    try {
      await assertWithin(ws.id, "publish");
    } catch (e) {
      if (e instanceof LimitReached) return { error: limitMessage(e, t.nr.news.actions) };
      throw e;
    }
  }

  const typedCaption = input.caption.trim();
  if (!typedCaption && !input.media) return { error: t.publish.blockNeedContent };
  if ((targets.includes("IG") || targets.includes("TT")) && !input.media) {
    return { error: m.needMedia };
  }
  // youtubeProblem has a single, Sorani answer; the dictionary has the same sentence.
  if (youtubeProblem(targets, input.media)) return { error: t.publish.ytVideoOnly };
  // Every YouTube upload carries the person's own title, description, privacy and audience (YouTube API policy III.E.3.f, III.J.2.b).
  if (targets.includes("YT") && (!input.youtube || youtubeOptionProblems(input.youtube).length)) return { error: t.publish.blockYtOptions };
  if (input.media) {
    if (!isOwnPathname(input.media.pathname, ws.id) || !/^https:\/\//.test(input.media.url)) {
      return { error: m.badFile };
    }
    // Our server downloads the YouTube video from this URL, so it must be one of this workspace's own Blob files.
    if (targets.includes("YT") && !isOwnBlobUrl(input.media.url, ws.id)) {
      return { error: m.badFile };
    }
    if (input.media.type === "IMAGE" && (targets.includes("IG") || targets.includes("TT")) && !isJpegPath(input.media.pathname)) {
      return { error: m.jpgOnly };
    }
  }

  // A news post is exactly what the editor typed — no source credit is
  // appended. The draft's source is used only to re-check it for copying.
  const caption = typedCaption;
  if (input.newsDraftId) {
    const draft = await db.newsDraft.findFirst({ where: { id: input.newsDraftId, tenantId: ws.id }, include: { item: true } });
    if (!draft) return { error: t.nr.news.actions.notFound };
    // The media is the draft's own card, or the auto-video made from it (src/lib/news/video.ts).
    const isCard = !!draft.cardPath && draft.cardPath === input.media?.pathname;
    const isVideo =
      !isCard &&
      input.media?.type === "VIDEO" &&
      (await db.newsVideo.count({ where: { tenantId: ws.id, draftId: draft.id, videoPath: input.media.pathname } })) > 0;
    if (!isCard && !isVideo) {
      return { error: m.cardChanged };
    }
    const copyProblem = checkDraft({ headline: "", body: typedCaption }, { title: draft.item.title, snippet: draft.item.snippet }, t.nr.news).find(
      (p) => p.code === "COPY",
    );
    if (copyProblem) return { error: copyProblem.message };
  }
  if (captionProblems(caption, targets).length) return { error: t.publish.blockCaptionLong };

  // Which accounts each platform goes to: the chosen ones that are really this workspace's, or the default.
  const jobs: { target: Target; accountId?: string; accountName?: string }[] = [];
  const unknownAccount: PublishOutcome[] = [];
  let lists: Awaited<ReturnType<typeof loadAccountLists>> | null = null;
  for (const target of targets) {
    const asked = [...new Set((input.accounts?.[target] ?? []).filter((x): x is string => typeof x === "string" && !!x))];
    if (!asked.length) {
      // With several accounts on a platform nobody gets a post they did not pick (an older scheduled
      // post, or a request that skipped the composer): it fails and says why.
      lists ??= await loadAccountLists(ws.id);
      if (lists[TARGET_PROVIDER[target]].length > 1) {
        unknownAccount.push({ target, ok: false, error: t.publish.blockPickAccount });
        continue;
      }
      jobs.push({ target });
      continue;
    }
    const rows = await db.oAuthCredential.findMany({
      where: { tenantId: ws.id, provider: TARGET_PROVIDER[target], providerAccountId: { in: asked } },
      select: { providerAccountId: true, providerAccountName: true },
    });
    const known = asked.filter((id) => rows.some((r) => r.providerAccountId === id));
    if (!known.length) {
      unknownAccount.push({ target, ok: false, error: m.unknownTarget });
      continue;
    }
    // TikTok's own rules show one creator's settings per post: one account.
    for (const id of target === "TT" ? known.slice(0, 1) : known) {
      jobs.push({ target, accountId: id, accountName: rows.find((r) => r.providerAccountId === id)?.providerAccountName ?? undefined });
    }
  }

  const runOne = async (target: Target): Promise<PublishOutcome> => {
    if (target === "FB") {
      const r = await publishToFacebookPage(ws.id, {
        message: caption,
        mediaUrl: input.media?.url,
        mediaType: input.media?.type,
      });
      return { target, ok: r.ok, url: r.permalinkUrl, externalId: r.externalId, error: r.error };
    }
    if (target === "IG") {
      const r = await publishToInstagram(ws.id, { caption, mediaUrl: input.media!.url, mediaType: input.media!.type }, input.igDeadlineMs);
      if (!r.ok && r.pending && (await parkInstagramContainer({ tenantId: ws.id, igUserId: r.pending.accountId, containerId: r.pending.containerId, draftId: input.newsDraftId }))) {
        return { target, ok: false, pending: true, error: m.igProcessing };
      }
      return { target, ok: r.ok, url: r.permalinkUrl, externalId: r.externalId, error: r.error };
    }
    if (target === "YT") {
      // publishToYouTube downloads the video from its public Blob URL, then uploads it.
      const yt = input.youtube!;
      const r = await publishToYouTube(ws.id, {
        title: yt.title.trim(),
        description: yt.description,
        privacy: yt.privacy!,
        madeForKids: yt.madeForKids!,
        videoUrl: input.media!.url,
      });
      return { target, ok: r.ok, url: r.permalinkUrl, externalId: r.externalId, error: r.error };
    }
    // TikTok pulls the video from our verified domain, through the media proxy.
    const tt = input.tiktok;
    if (!tt) return { target, ok: false, error: m.ttNoSettings };
    const info = await getTikTokPostContext(ws.id);
    if ("error" in info) return { target, ok: false, error: info.error };
    const problems = tiktokProblems(
      { privacy: tt.privacy, commercial: tt.commercial, yourBrand: tt.yourBrand, branded: tt.branded, durationSec: input.media!.durationSec },
      { privacyOptions: info.privacy_level_options ?? [], maxDurationSec: info.max_video_post_duration_sec },
    );
    if (problems.length) return { target, ok: false, error: m.ttIncomplete(problems.join(", ")) };
    const mediaUrl = `${APP_ORIGIN}/m/${input.media!.pathname}`;
    if (input.media!.type === "IMAGE") {
      const r = await publishPhotoToTikTok(
        ws.id,
        { caption, imageUrl: mediaUrl },
        {
          privacyLevel: tt.privacy!,
          disableComment: !tt.allowComment,
          brandOrganicToggle: tt.commercial && tt.yourBrand,
          brandContentToggle: tt.commercial && tt.branded,
        },
      );
      return { target, ok: r.ok, publishId: r.externalId, error: r.error };
    }
    const r = await publishToTikTok(
      ws.id,
      { title: caption, videoUrl: mediaUrl, durationSec: input.media!.durationSec },
      {
        privacyLevel: tt.privacy!,
        disableComment: !tt.allowComment,
        disableDuet: !tt.allowDuet,
        disableStitch: !tt.allowStitch,
        brandOrganicToggle: tt.commercial && tt.yourBrand,
        brandContentToggle: tt.commercial && tt.branded,
      },
    );
    return { target, ok: r.ok, publishId: r.externalId, error: r.error };
  };

  const run = async (job: (typeof jobs)[number]): Promise<PublishOutcome> => {
    const outcome = job.accountId ? await withAccounts({ [TARGET_PROVIDER[job.target]]: job.accountId }, () => runOne(job.target)) : await runOne(job.target);
    return { ...outcome, ...(job.accountId ? { accountId: job.accountId, accountName: job.accountName } : {}) };
  };
  const settled = await Promise.allSettled(jobs.map(run));
  const results = [
    ...unknownAccount,
    ...settled.map((s, i): PublishOutcome =>
      s.status === "fulfilled"
        ? s.value
        : { target: jobs[i].target, accountId: jobs[i].accountId, accountName: jobs[i].accountName, ok: false, error: s.reason instanceof Error ? s.reason.message : t.common.error },
    ),
  ];
  for (const r of results) {
    const meta: Prisma.InputJsonObject = {
      target: r.target,
      ...(r.accountId ? { accountId: r.accountId } : {}),
      ...(r.url ? { url: r.url } : {}),
      ...(r.publishId ? { publishId: r.publishId } : {}),
      ...(r.error ? { error: r.error.slice(0, 500) } : {}),
    };
    await audit(ws.id, r.ok ? "app.publish" : "app.publish_failed", `${r.ok ? "Published" : "Failed to publish"} to ${r.target}.`, meta);
  }
  if (input.newsDraftId) {
    try {
      await recordNewsPublish(ws.id, input.newsDraftId, results);
    } catch (e) {
      // The post already went out; a bookkeeping failure must not turn that into a reported failure.
      console.error("recordNewsPublish failed:", e instanceof Error ? e.message : "unknown error");
    }
  }
  if (input.productId) {
    for (const o of results) {
      if (o.ok && o.externalId && (o.target === "FB" || o.target === "IG")) {
        await tagPublishedPost(ws.id, o.target === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", o.externalId, input.productId, o.accountId).catch(() => {});
      }
    }
  }
  return results;
}
