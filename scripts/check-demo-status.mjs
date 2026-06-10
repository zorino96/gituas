// Read-only: status of the seeded demo post chain.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const env = readFileSync("C:/Users/Zorin/Desktop/gituas/.env", "utf8");
const url = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1];
const c = new Client({ connectionString: url });
await c.connect();

const { rows: pp } = await c.query(
  `SELECT id, status, "errorMessage", "platformPostId", "permalinkUrl", "postedAt", "updatedAt"
   FROM "PlatformPost" WHERE id LIKE 'pp_demo%' ORDER BY "createdAt" DESC LIMIT 3`,
);
const { rows: ar } = await c.query(
  `SELECT id, status, "decidedAt" FROM "ApprovalRequest" WHERE id LIKE 'ar_demo%' ORDER BY "createdAt" DESC LIMIT 3`,
);
console.log(JSON.stringify({ platformPosts: pp, approvals: ar }, null, 2));
await c.end();
