import { PrismaClient } from "../src/generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const plan = await db.marketingPlan.findFirst({ orderBy: { createdAt: "desc" } });
console.log("=== MarketingPlan.data keys ===");
console.log(Object.keys(plan?.data ?? {}));
console.log("=== First weeklyTheme ===");
console.log(JSON.stringify(plan?.data?.weeklyThemes?.[0] ?? null, null, 2));
console.log("=== First content item ===");
console.log(JSON.stringify(plan?.data?.contentItems?.[0] ?? null, null, 2));
console.log("=== First ad campaign ===");
console.log(JSON.stringify(plan?.data?.adCampaigns?.[0] ?? null, null, 2));

const mode = await db.projectMode.findFirst({});
console.log("=== ProjectMode row ===");
console.log(JSON.stringify(mode, null, 2));

process.exit(0);
