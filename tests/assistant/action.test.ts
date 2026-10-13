import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER", kind: "MERCHANT" } as { id: string; role: string; kind: string } | null }));
const plan = vi.hoisted(() => ({ aiUsd: 2 }));

vi.mock("@/app/app/data", () => ({
  currentWorkspace: vi.fn(async () => ws.current),
  loadConnections: vi.fn(async () => ({
    META_FACEBOOK: { connected: true, name: "Page" },
    META_INSTAGRAM: { connected: false },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: false },
  })),
}));
vi.mock("@/lib/i18n", async () => {
  const { en } = await import("@/lib/i18n/en");
  return { dict: () => en, getLang: async () => "en" };
});
vi.mock("@/lib/db", () => ({ db: { store: { findMany: vi.fn(async () => []) }, product: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/app/app/actions", () => ({ publishAction: vi.fn() }));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: plan.aiUsd })) }));
vi.mock("@/lib/ai/slots", () => ({
  claimSlot: vi.fn(async () => ({ ok: true, month: "2026-10", day: "2026-10-13" })),
  refundSlot: vi.fn(async () => undefined),
  takeDaily: vi.fn(async () => 1),
}));
vi.mock("@/lib/assistant/state", () => ({ loadAssistantState: vi.fn(async () => ({ shops: [{ plan: "MERCHANT" }] })) }));
vi.mock("@/lib/assistant/ask", async (orig) => ({ ...(await orig<typeof import("@/lib/assistant/ask")>()), askAssistant: vi.fn() }));

import { claimSlot, refundSlot, takeDaily } from "@/lib/ai/slots";
import { askAssistant } from "@/lib/assistant/ask";
import { askAssistantAction } from "@/app/app/assistant/actions";

const ask = { workspaceId: "t1", messages: [{ role: "user" as const, text: "چۆن؟" }] };

beforeEach(() => {
  vi.clearAllMocks();
  plan.aiUsd = 2;
  ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
  vi.mocked(askAssistant).mockResolvedValue({ reply: "وەڵام", followups: ["دواتر؟"], action: null });
  vi.mocked(takeDaily).mockResolvedValue(1);
});

describe("askAssistantAction", () => {
  it("answers a shop's question, counting one place of the day and the month", async () => {
    expect(await askAssistantAction(ask)).toEqual({ ok: true, reply: "وەڵام", followups: ["دواتر؟"], proposal: null });
    expect(vi.mocked(claimSlot).mock.calls[0][2]).toEqual({ month: 24, day: 4 });
    expect(vi.mocked(askAssistant).mock.calls[0][0]).toMatchObject({ tenantId: "t1", lang: "en", uncounted: false });
  });

  it("gives a workspace with no shop a few uncounted questions, so a new owner can ask how to start", async () => {
    plan.aiUsd = 0;
    await askAssistantAction(ask);
    expect(vi.mocked(claimSlot).mock.calls[0][2]).toEqual({ month: 6, day: 3 });
    expect(vi.mocked(askAssistant).mock.calls[0][0]).toMatchObject({ uncounted: true });
  });

  it("turns away a signed-out visitor, a news desk, and a member who cannot open billing", async () => {
    ws.current = null;
    expect(await askAssistantAction(ask)).toMatchObject({ ok: false, contact: false });
    ws.current = { id: "t1", role: "OWNER", kind: "NEWS" };
    expect(await askAssistantAction(ask)).toMatchObject({ ok: false, contact: true });
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect(await askAssistantAction(ask)).toMatchObject({ ok: false, contact: false });
    expect(askAssistant).not.toHaveBeenCalled();
    expect(claimSlot).not.toHaveBeenCalled();
  });

  it("says which number ran out, the day's or the month's, and offers the support number", async () => {
    vi.mocked(claimSlot).mockResolvedValueOnce({ ok: false, error: "daily" });
    const day = await askAssistantAction(ask);
    vi.mocked(claimSlot).mockResolvedValueOnce({ ok: false, error: "limit" });
    const month = await askAssistantAction(ask);
    expect(day).toMatchObject({ ok: false, contact: true });
    expect(month).toMatchObject({ ok: false, contact: true });
    expect((day as { error: string }).error).not.toBe((month as { error: string }).error);
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it("gives the place back when no answer could be made, but only a few times a day", async () => {
    vi.mocked(askAssistant).mockRejectedValue(new Error("down"));
    expect(await askAssistantAction(ask)).toMatchObject({ ok: false, contact: true });
    expect(refundSlot).toHaveBeenCalledTimes(1);
    vi.mocked(takeDaily).mockResolvedValue(0);
    await askAssistantAction(ask);
    expect(refundSlot).toHaveBeenCalledTimes(1);
  });

  it("does not take a place for nothing to answer", async () => {
    expect(await askAssistantAction({ workspaceId: "t1", messages: [{ role: "assistant", text: "x" }] })).toMatchObject({ ok: false });
    expect(claimSlot).not.toHaveBeenCalled();
  });
});
