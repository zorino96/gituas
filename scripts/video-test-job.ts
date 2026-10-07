// Makes one TEST auto-video on a desk without posting anything: drafts the given story if it has
// no draft, queues a NewsVideo with autoPost=false and voices it (prepareVideo). The GitHub Actions
// worker (reel.yml) then renders it; the video stays RENDERED and is never posted.
//   npx tsx --env-file=.env --env-file=.env.local scripts/video-test-job.ts <tenantId> <itemId> [voice] [speed]
// A story with no draft needs TEST_HEADLINE and TEST_BODY. Prints ids and status only, never a key.
import { db } from "@/lib/db";
import { prepareVideo } from "@/lib/news/video";

async function main() {
  const [tenantId, itemId, voice = "male", speed = "1"] = process.argv.slice(2);
  if (!tenantId || !itemId) throw new Error("usage: video-test-job.ts <tenantId> <itemId> [voice] [speed]");

  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId }, select: { id: true } });
  if (!item) throw new Error("story not found on this desk");
  let draft = await db.newsDraft.findUnique({ where: { itemId }, select: { id: true } });
  if (!draft) {
    const headline = process.env.TEST_HEADLINE;
    const body = process.env.TEST_BODY;
    if (!headline || !body) throw new Error("the story has no draft: pass TEST_HEADLINE and TEST_BODY");
    const story = await db.newsItem.findUnique({ where: { id: itemId }, select: { category: true } });
    draft = await db.newsDraft.create({
      data: { itemId, tenantId, headline, body, category: story?.category ?? "politics", cardKind: "BREAKING", model: "test" },
      select: { id: true },
    });
    console.log("draft", draft.id);
  }
  const job = await db.newsVideo.create({ data: { tenantId, itemId, draftId: draft.id, voice, speed: Number(speed), autoPost: false }, select: { id: true } });
  console.log("job", job.id);
  const ok = await prepareVideo(job.id);
  const after = await db.newsVideo.findUnique({ where: { id: job.id }, select: { status: true, error: true } });
  console.log("prepared", ok, after?.status, after?.error ?? "");
}

main()
  .catch((e) => {
    console.error("error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
