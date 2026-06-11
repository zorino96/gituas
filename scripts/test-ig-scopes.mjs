// One successful API call per new Instagram scope, to satisfy App Review's
// "≥1 call per permission in the last 30 days" requirement and to smoke-test
// the engagement integration. Run: node scripts/test-ig-scopes.mjs
import { createDecipheriv } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv").config();
const { PrismaClient } = require("../src/generated/prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const IV_LEN = 12, TAG_LEN = 16;
function vaultDecrypt(blob) {
  const buf = Buffer.from(blob, "base64");
  const key = Buffer.from(process.env.VAULT_KEY, "hex");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, IV_LEN));
  d.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([d.update(buf.subarray(IV_LEN + TAG_LEN)), d.final()]).toString("utf8");
}

const V = "https://graph.instagram.com/v25.0";

async function get(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
}

(async () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const cred = await db.oAuthCredential.findFirst({
    where: { provider: "META_INSTAGRAM" }, orderBy: { updatedAt: "desc" },
  });
  const token = vaultDecrypt(cred.tokenEncrypted);
  const ig = cred.providerAccountId;
  const t = encodeURIComponent(token);
  const line = (s) => console.log(s);

  // --- manage_insights ---
  line("\n=== instagram_business_manage_insights ===");
  let r = await get(`${V}/${ig}/insights?metric=reach&period=day&metric_type=total_value&access_token=${t}`);
  if (!r.ok) r = await get(`${V}/${ig}/insights?metric=reach&period=day&access_token=${t}`);
  line(`status ${r.status} → ${JSON.stringify(r.j).slice(0, 300)}`);

  // --- manage_comments (list media, then read comments on the first one) ---
  line("\n=== instagram_business_manage_comments ===");
  const media = await get(`${V}/${ig}/media?fields=id,caption&limit=1&access_token=${t}`);
  line(`media list status ${media.status} → ${JSON.stringify(media.j).slice(0, 200)}`);
  const mediaId = media.j?.data?.[0]?.id;
  if (mediaId) {
    const c = await get(`${V}/${mediaId}/comments?fields=id,text,username&access_token=${t}`);
    line(`comments status ${c.status} → ${JSON.stringify(c.j).slice(0, 300)}`);
  } else {
    line("no media yet — comments call skipped");
  }

  // --- manage_messages (list conversations) ---
  line("\n=== instagram_business_manage_messages ===");
  const conv = await get(`${V}/${ig}/conversations?platform=instagram&access_token=${t}`);
  line(`status ${conv.status} → ${JSON.stringify(conv.j).slice(0, 300)}`);

  await db.$disconnect();
})();
