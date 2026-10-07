// Diagnoses an auto-video whose voice failed: writes the reel script for a draft and asks Pawan.krd
// for every segment, printing which texts it accepts. Nothing is stored.
//   npx tsx --env-file=.env --env-file=.env.local scripts/video-script-check.ts <draftId>
import { db } from "@/lib/db";
import { completeJson } from "@/lib/ai/provider";
import { parseReelScript, reelPrompt } from "@/lib/news/video";
import { speechText } from "@/lib/voice/tts";

async function main() {
  const draft = await db.newsDraft.findUnique({ where: { id: process.argv[2] }, select: { headline: true, body: true } });
  if (!draft) throw new Error("no draft");
  const { system, user } = reelPrompt(draft);
  const script = (await completeJson({ system, user, strength: "fast", thinking: false }, parseReelScript)).data;
  for (const seg of script.segments) {
    const res = await fetch("https://api.pawan.krd/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PAWAN_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "pkrd/tts-ku", input: speechText(seg.say), voice: "male", response_format: "mp3" }),
    });
    const ok = res.ok && !/json/.test(res.headers.get("content-type") ?? "");
    console.log(ok ? "OK  " : `FAIL ${res.status}`, seg.kind, "|", seg.say);
  }
}

main()
  .catch((e) => {
    console.error("error:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
