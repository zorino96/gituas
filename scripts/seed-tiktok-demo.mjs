// Seeds one TikTok demo post chain so the recording has something to approve:
//   ContentPost (PENDING_APPROVAL, video = /demo/sample.webm)
//   └─ PlatformPost (TIKTOK, PENDING_APPROVAL)
//   └─ ApprovalRequest (CONTENT_POST, PENDING)
// Idempotent: skips if the demo post already exists.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const env = readFileSync("C:/Users/Zorin/Desktop/gituas/.env", "utf8");
const url = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1];
if (!url) throw new Error("DATABASE_URL not found in .env");

const VIDEO_URL = "https://gituas.vercel.app/demo/sample.webm";
const id = (p) => `${p}_${randomBytes(10).toString("hex")}`;

const c = new Client({ connectionString: url });
await c.connect();

const { rows: projects } = await c.query(
  `SELECT id, name FROM "Project" ORDER BY "createdAt" ASC LIMIT 5`,
);
if (projects.length === 0) throw new Error("no projects in DB");
const project = projects.find((p) => /vidsave/i.test(p.name)) ?? projects[0];
console.log("project:", project.name, project.id);

const { rows: existing } = await c.query(
  `SELECT id FROM "ContentPost" WHERE "sourceAssetUrl" = $1 AND status = 'PENDING_APPROVAL'`,
  [VIDEO_URL],
);
if (existing.length > 0) {
  console.log("demo post already seeded:", existing[0].id);
  await c.end();
  process.exit(0);
}

const cpId = id("cp_demo");
const ppId = id("pp_demo");
const arId = id("ar_demo");

await c.query(
  `INSERT INTO "ContentPost"
     (id, "projectId", "sourceAssetUrl", "sourceAssetType", description, hashtags, status, "createdAt", "updatedAt")
   VALUES ($1, $2, $3, 'VIDEO'::"AssetType", $4, $5, 'PENDING_APPROVAL'::"PostStatus", now(), now())`,
  [
    cpId,
    project.id,
    VIDEO_URL,
    "While you slept, your software shipped, posted, and got paid. Gituas — autonomous marketing for indie makers. 🌙",
    ["buildinpublic", "indiedev", "automation", "saas"],
  ],
);
await c.query(
  `INSERT INTO "PlatformPost"
     (id, "contentPostId", platform, status, "createdAt", "updatedAt")
   VALUES ($1, $2, 'TIKTOK'::"Platform", 'PENDING_APPROVAL'::"PostStatus", now(), now())`,
  [ppId, cpId],
);
await c.query(
  `INSERT INTO "ApprovalRequest"
     (id, "projectId", kind, payload, status, "createdAt", "updatedAt")
   VALUES ($1, $2, 'CONTENT_POST'::"ApprovalKind", $3, 'PENDING'::"ApprovalStatus", now(), now())`,
  [arId, project.id, { contentPostId: cpId, summary: "TikTok demo post — NOCTURNE clip" }],
);

console.log("seeded:", { contentPost: cpId, platformPost: ppId, approval: arId });
await c.end();
