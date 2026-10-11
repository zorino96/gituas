// Who follows the shop on Instagram (age, gender, city) and how its recent posts did, read with the
// instagram_business_manage_insights permission the shop already granted. Feeds the per-platform
// boost settings and the hashtags that worked. Meta only shows demographics for accounts with
// about 100+ followers; below that, or on any error, these return nothing and the callers fall back.

import { getIgCred, V } from "./instagram";

export interface IgAudience {
  /** Age ranges ("18-24", …) with their share of followers, in Meta's order. */
  ages: { range: string; share: number }[];
  /** Share of followers who are women / men (0–1), null when Meta did not say. */
  women: number | null;
  men: number | null;
  /** The cities followers live in, biggest first, with their share. */
  cities: { name: string; share: number }[];
}

export interface IgPost {
  id: string;
  caption: string;
  likes: number;
  comments: number;
}

type Breakdown = { dimension_values?: string[]; value?: number }[];

/** The rows of one follower_demographics breakdown answer. */
export function breakdownRows(json: unknown): { key: string; value: number }[] {
  const data = (json as { data?: { total_value?: { breakdowns?: { results?: Breakdown }[] } }[] })?.data;
  const results = data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  return results
    .map((r) => ({ key: String(r.dimension_values?.[0] ?? ""), value: typeof r.value === "number" ? r.value : 0 }))
    .filter((r) => r.key && r.value > 0);
}

/** Turns the three breakdowns into shares. Pure, so it can be tested. */
export function audienceFrom(age: { key: string; value: number }[], gender: { key: string; value: number }[], city: { key: string; value: number }[]): IgAudience | null {
  const sum = (rows: { value: number }[]) => rows.reduce((n, r) => n + r.value, 0);
  const ageTotal = sum(age);
  const genderTotal = sum(gender);
  const cityTotal = sum(city);
  if (!ageTotal && !genderTotal && !cityTotal) return null;
  const share = (v: number, total: number) => (total ? Math.round((v / total) * 1000) / 1000 : 0);
  const order = (r: string) => Number(r.split(/[-+]/)[0]) || 0;
  return {
    ages: [...age].sort((a, b) => order(a.key) - order(b.key)).map((r) => ({ range: r.key, share: share(r.value, ageTotal) })),
    women: genderTotal ? share(gender.find((g) => g.key === "F")?.value ?? 0, genderTotal) : null,
    men: genderTotal ? share(gender.find((g) => g.key === "M")?.value ?? 0, genderTotal) : null,
    cities: [...city].sort((a, b) => b.value - a.value).slice(0, 5).map((r) => ({ name: r.key, share: share(r.value, cityTotal) })),
  };
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** The connected account's follower demographics, or null. Never throws. */
export async function fetchIgAudience(tenantId: string): Promise<IgAudience | null> {
  const cred = await getIgCred(tenantId).catch(() => null);
  if (!cred) return null;
  const token = encodeURIComponent(cred.token);
  const url = (breakdown: string) =>
    `${V}/${cred.igUserId}/insights?metric=follower_demographics&period=lifetime&timeframe=this_month&metric_type=total_value&breakdown=${breakdown}&access_token=${token}`;
  const [age, gender, city] = await Promise.all([getJson(url("age")), getJson(url("gender")), getJson(url("city"))]);
  return audienceFrom(breakdownRows(age), breakdownRows(gender), breakdownRows(city));
}

/** The account's recent posts with their caption and engagement, or [] (for the hashtags that worked). */
export async function fetchIgPosts(tenantId: string, limit = 25): Promise<IgPost[]> {
  const cred = await getIgCred(tenantId).catch(() => null);
  if (!cred) return [];
  const j = (await getJson(`${V}/${cred.igUserId}/media?fields=id,caption,like_count,comments_count&limit=${limit}&access_token=${encodeURIComponent(cred.token)}`)) as {
    data?: { id: string; caption?: string; like_count?: number; comments_count?: number }[];
  } | null;
  return (j?.data ?? []).map((m) => ({ id: m.id, caption: m.caption ?? "", likes: m.like_count ?? 0, comments: m.comments_count ?? 0 }));
}
