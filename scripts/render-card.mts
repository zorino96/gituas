// Render one draft's card on this machine and save the JPEG, to look at it.
// Reads only: nothing is uploaded and the draft is not touched.
// The dev server must be running at the origin (default http://localhost:3001).
//   npx tsx --env-file=.env --env-file=.env.local scripts/render-card.mts <draftId> <out.jpg> [origin]
import { writeFile } from "node:fs/promises";

import sharp from "sharp";

import { renderCardServer } from "../src/lib/cards/server-render";

const [draftId, out, origin = "http://localhost:3001"] = process.argv.slice(2);
if (!draftId || !out) {
  console.error("usage: render-card.mts <draftId> <out.jpg> [origin]");
  process.exit(1);
}

const started = Date.now();
try {
  const jpeg = await renderCardServer(draftId, origin);
  await writeFile(out, jpeg);
  const meta = await sharp(jpeg).metadata();
  console.log(`${out}: ${meta.format} ${meta.width}x${meta.height}, ${jpeg.length} bytes, ${Date.now() - started} ms`);
  process.exit(0);
} catch (e) {
  console.error(`render failed after ${Date.now() - started} ms:`, e);
  process.exit(1);
}
