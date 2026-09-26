// Monthly quotas per plan for the news desk. These are the launch defaults;
// change them here when packages are priced. Each costly action is refused at
// its quota, so what a page can spend is bounded by what its plan allows.
export type Metric = "draft" | "improve" | "publish";
type Plan = "MANUAL" | "AUTO" | "ENTERPRISE";

export const NEWS_LIMITS: Record<Plan, Record<Metric, number> & { sources: number }> = {
  MANUAL: { draft: 300, improve: 30, publish: 300, sources: 10 },
  AUTO: { draft: 3000, improve: 300, publish: 3000, sources: 30 },
  ENTERPRISE: { draft: 20000, improve: 2000, publish: 20000, sources: 100 },
};
