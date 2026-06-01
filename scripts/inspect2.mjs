import { PrismaClient } from "../src/generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const plan = await db.marketingPlan.findFirst({ orderBy: { createdAt: "desc" } });
console.log("positioning:", typeof plan?.data?.positioning, JSON.stringify(plan?.data?.positioning)?.slice(0, 100));
console.log("strategy len:", plan?.data?.strategy?.length);
console.log("earlyWins:", JSON.stringify(plan?.data?.earlyWins?.slice(0, 2)));
console.log("kpis:", JSON.stringify(plan?.data?.kpis?.slice(0, 3)));
console.log("first risk:", JSON.stringify(plan?.data?.risks?.[0]));
console.log("plan status:", plan?.status, plan?.generatedBy);

// Verify project.mode include works
const project = await db.project.findFirst({ include: { mode: true } });
console.log("project.mode:", JSON.stringify(project?.mode, null, 2));
process.exit(0);
