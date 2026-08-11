// Seeds one Facebook and one Instagram post chain so the App Review screencast
// has something real to approve and publish:
//   ContentPost (PENDING_APPROVAL, image asset)
//   └─ PlatformPost (META_FACEBOOK / META_INSTAGRAM, PENDING_APPROVAL)
//   └─ ApprovalRequest (CONTENT_POST, PENDING)
//
// Meta's reviewers want the end-to-end use of each permission, so the post has
// to actually go out — a mocked screen would be the same failure that got the
// last submission rejected.
//
// Idempotent: skips a platform if a pending demo post for it already exists.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const env = readFileSync("C:/Users/Zorin/Desktop/gituas/.env", "utf8");
const url = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1];
if (!url) throw new Error("DATABASE_URL not found in .env");

// Instagram rejects anything that is not a real reachable image/video URL, so
// this points at the deployed demo asset rather than a placeholder service.
const IMAGE_URL = "https://gituas.vercel.app/brand/gituas-icon-1024.png";
const DESCRIPTION =
  "Gituas posts for you while you sleep. Every draft waits for your approval first.";
const HASHTAGS = ["gituas", "smallbusiness", "automation"];

const id = (p) => `${p}_${randomBytes(10).toString("hex")}`;
const c = new Client({ connectionString: url });
await c.connect();

const { rows: projects } = await c.query(
  `SELECT id, name FROM "Project" ORDER BY "createdAt" ASC LIMIT 5`,
);
if (projects.length === 0) throw new Error("no projects in DB");
const project = projects.find((p) => /vidsave/i.test(p.name)) ?? projects[0];
console.log("project:", project.name, project.id);

for (const platform of ["META_FACEBOOK", "META_INSTAGRAM"]) {
  const { rows: existing } = await c.query(
    `SELECT cp.id FROM "ContentPost" cp
       JOIN "PlatformPost" pp ON pp."contentPostId" = cp.id
      WHERE pp.platform = $1::"Platform" AND pp.status = 'PENDING_APPROVAL'`,
    [platform],
  );
  if (existing.length > 0) {
    console.log(`${platform}: already pending ->`, existing[0].id);
    continue;
  }

  const cpId = id("cp_meta");
  const ppId = id("pp_meta");
  const arId = id("ar_meta");

  await c.query(
    `INSERT INTO "ContentPost"
       (id, "projectId", "sourceAssetUrl", "sourceAssetType", description, hashtags, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'IMAGE'::"AssetType", $4, $5, 'PENDING_APPROVAL'::"PostStatus", now(), now())`,
    [cpId, project.id, IMAGE_URL, DESCRIPTION, HASHTAGS],
  );
  await c.query(
    `INSERT INTO "PlatformPost"
       (id, "contentPostId", platform, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3::"Platform", 'PENDING_APPROVAL'::"PostStatus", now(), now())`,
    [ppId, cpId, platform],
  );
  // payload keys must match what the approvals card reads, or the card renders
  // blank: `preview` is the body it shows, `platform` the badge.
  await c.query(
    `INSERT INTO "ApprovalRequest"
       (id, "projectId", kind, payload, status, "createdAt", "updatedAt")
     VALUES ($1, $2, 'CONTENT_POST'::"ApprovalKind", $3, 'PENDING'::"ApprovalStatus", now(), now())`,
    [
      arId,
      project.id,
      {
        contentPostId: cpId,
        platform,
        preview: `${DESCRIPTION} ${HASHTAGS.map((h) => `#${h}`).join(" ")}`,
      },
    ],
  );
  console.log(`${platform}: seeded ->`, { contentPost: cpId, platformPost: ppId, approval: arId });
}

await c.end();
