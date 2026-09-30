import { describe, expect, it } from "vitest";
import { decideComment, decideDm, type Classification } from "@/lib/shop/policy";

const c = (type: Classification["type"], intent: Classification["intent"] = "none", confidence = 0.9): Classification => ({ type, intent, language: "ckb", confidence });
const ctx = { hasProduct: true, hasDefaultDm: false, likeComments: true, autoHideSpam: false, isFacebook: true, whatsappAlways: false, canPrivateReply: true };

describe("decideComment", () => {
  it("answers a question publicly and privately with the card, and likes it on Facebook", () => {
    expect(decideComment(c("QUESTION", "price"), ctx)).toEqual({
      actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, { kind: "PRIVATE_REPLY", content: "card", whatsapp: false }, { kind: "LIKE" }],
      flag: null,
    });
  });
  it("adds WhatsApp for an order, or always when the template says so", () => {
    expect(decideComment(c("ORDER"), ctx).actions).toContainEqual({ kind: "PRIVATE_REPLY", content: "card", whatsapp: true });
    expect(decideComment(c("QUESTION", "price"), { ...ctx, whatsappAlways: true }).actions).toContainEqual({ kind: "PRIVATE_REPLY", content: "card", whatsapp: true });
  });
  it("falls back to the default DM, or flags the post when there is none", () => {
    expect(decideComment(c("QUESTION", "price"), { ...ctx, hasProduct: false, hasDefaultDm: true })).toEqual({
      actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, { kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false }, { kind: "LIKE" }],
      flag: null,
    });
    expect(decideComment(c("QUESTION", "price"), { ...ctx, hasProduct: false })).toEqual({
      actions: [{ kind: "LIKE" }],
      flag: "no_product",
    });
  });
  it("skips the private reply when it is no longer allowed, and likes only on Facebook", () => {
    expect(decideComment(c("QUESTION", "price"), { ...ctx, canPrivateReply: false, isFacebook: false })).toEqual({ actions: [], flag: "private_window" });
  });
  it("thanks praise", () => {
    expect(decideComment(c("PRAISE"), ctx)).toEqual({ actions: [{ kind: "PUBLIC_REPLY", style: "thanks" }, { kind: "LIKE" }], flag: null });
  });
  it("stays silent and flags negotiation, complaints and anything else", () => {
    expect(decideComment(c("NEGOTIATION"), ctx)).toEqual({ actions: [], flag: "negotiation" });
    expect(decideComment(c("COMPLAINT"), ctx)).toEqual({ actions: [], flag: "complaint" });
    expect(decideComment(c("OTHER"), ctx)).toEqual({ actions: [], flag: "other" });
  });
  it("hides spam and abuse only when the store asked for it", () => {
    expect(decideComment(c("SPAM"), ctx)).toEqual({ actions: [], flag: "spam" });
    expect(decideComment(c("ABUSE"), { ...ctx, autoHideSpam: true })).toEqual({ actions: [{ kind: "HIDE" }], flag: "abuse" });
  });
  it("does nothing on low confidence", () => {
    expect(decideComment(c("QUESTION", "price", 0.4), ctx)).toEqual({ actions: [], flag: "low_confidence" });
  });
});

describe("decideDm", () => {
  const dctx = { boundProduct: true, firstReply: false, hasPhotos: true };
  it("sends photos on the first reply, then answers product questions", () => {
    expect(decideDm(c("QUESTION", "size_colour"), { ...dctx, firstReply: true })).toEqual({
      actions: [{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "size_colour", whatsapp: false }],
      flag: null,
    });
  });
  it("answers an order with WhatsApp", () => {
    expect(decideDm(c("ORDER", "none"), dctx)).toEqual({ actions: [{ kind: "DM_ANSWER", intent: "none", whatsapp: true }], flag: null });
  });
  it("flags what the card cannot answer", () => {
    expect(decideDm(c("QUESTION", "address"), dctx)).toEqual({ actions: [], flag: "needs_you" });
    expect(decideDm(c("NEGOTIATION"), dctx)).toEqual({ actions: [], flag: "negotiation" });
    expect(decideDm(null, dctx)).toEqual({ actions: [], flag: "unclear" });
  });
  it("lets thanks pass silently", () => {
    expect(decideDm(c("PRAISE"), dctx)).toEqual({ actions: [], flag: null });
  });
  it("flags every DM with no product behind it", () => {
    expect(decideDm(c("QUESTION", "price"), { ...dctx, boundProduct: false })).toEqual({ actions: [], flag: "no_product" });
  });
});
