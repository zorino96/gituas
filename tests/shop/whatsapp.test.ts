import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { classifyMetaError } from "@/lib/shop/meta-errors";
import { templateName, toWaBody } from "@/lib/whatsapp/cloud";
import { mediaToken, parseWaPayload, productNamedIn, typedText } from "@/lib/whatsapp/webhook";

const payload = (field: string, value: object) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA1", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: "9647500000000", phone_number_id: "PN1" }, ...value } }] }],
});

describe("parseWaPayload", () => {
  it("reads a text message with the buyer's profile name", () => {
    const evs = parseWaPayload(
      payload("messages", {
        contacts: [{ wa_id: "9647701112222", profile: { name: "Aram" } }],
        messages: [{ from: "9647701112222", id: "wamid.1", timestamp: "1", type: "text", text: { body: "سڵاو نرخی چەندە؟" } }],
      }),
    );
    expect(evs).toEqual([{ kind: "message", phoneNumberId: "PN1", messageId: "wamid.1", from: "9647701112222", name: "Aram", text: "سڵاو نرخی چەندە؟" }]);
  });

  it("turns media into a token with its caption, and button/list replies into their title", () => {
    const evs = parseWaPayload(
      payload("messages", {
        messages: [
          { from: "1", id: "a", type: "image", image: { id: "m", caption: "ئەمە هەیە؟" } },
          { from: "1", id: "b", type: "audio", audio: { id: "m" } },
          { from: "1", id: "c", type: "button", button: { text: "Yes", payload: "y" } },
          { from: "1", id: "d", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x", title: "Red" } } },
        ],
      }),
    );
    expect(evs.map((e) => (e.kind === "message" ? e.text : null))).toEqual(["[image] ئەمە هەیە؟", "[audio]", "Yes", "Red"]);
  });

  it("drops reactions, statuses and other objects", () => {
    expect(parseWaPayload(payload("messages", { messages: [{ from: "1", id: "r", type: "reaction", reaction: { emoji: "👍" } }] }))).toEqual([]);
    expect(parseWaPayload(payload("messages", { statuses: [{ id: "wamid.1", status: "read" }] }))).toEqual([]);
    expect(parseWaPayload({ object: "page", entry: [] })).toEqual([]);
    expect(parseWaPayload(null)).toEqual([]);
  });

  it("reports replies the merchant sent from the WhatsApp Business app", () => {
    const evs = parseWaPayload(payload("smb_message_echoes", { message_echoes: [{ from: "9647500000000", to: "9647701112222", id: "e1", type: "text" }] }));
    expect(evs).toEqual([{ kind: "echo", phoneNumberId: "PN1", to: "9647701112222" }]);
  });
});

describe("media tokens", () => {
  it("splits a token from its caption and leaves plain text alone", () => {
    expect(mediaToken("[image] red one")).toEqual({ type: "image", caption: "red one" });
    expect(mediaToken("[audio]")).toEqual({ type: "audio", caption: "" });
    expect(mediaToken("[size] 42")).toBeNull();
    expect(typedText("[image] red one")).toBe("red one");
    expect(typedText("[video]")).toBe("");
    expect(typedText("hello")).toBe("hello");
  });
});

describe("productNamedIn", () => {
  const products = [
    { id: "p1", name: "کراسی شین" },
    { id: "p2", name: "کراسی شینی درێژ" },
    { id: "p3", name: "Air Max" },
    { id: "p4", name: "تی" },
  ];

  it("finds the product the wa.me link pre-filled, longest name first", () => {
    expect(productNamedIn("کراسی شینی درێژ — 25,000 د.ع", products)).toBe("p2");
    expect(productNamedIn("کراسی شین — 20,000 د.ع", products)).toBe("p1");
  });

  it("ignores case, Arabic/Kurdish letter variants and very short names", () => {
    expect(productNamedIn("do you have the AIR MAX?", products)).toBe("p3");
    expect(productNamedIn("كراسي شين ماوە؟", products)).toBe("p1");
    expect(productNamedIn("تی", products)).toBeNull();
    expect(productNamedIn("سڵاو", products)).toBeNull();
  });
});

describe("WhatsApp sending helpers", () => {
  it("maps shop messages to WhatsApp bodies", () => {
    expect(toWaBody({ text: "hi" })).toEqual({ type: "text", text: { body: "hi", preview_url: true } });
    expect(toWaBody({ attachment: { type: "image", payload: { url: "https://x/y.jpg", is_reusable: true } } })).toEqual({ type: "image", image: { link: "https://x/y.jpg" } });
    expect(toWaBody({ attachment: { type: "template", payload: { template_type: "generic", elements: [] } } })).toBeNull();
  });

  it("accepts only WhatsApp-valid template names", () => {
    expect(templateName(" Order Ready ")).toBe("order_ready");
    expect(templateName("order-ready_2")).toBe("order_ready_2");
    expect(templateName("داواکاری")).toBeNull();
    expect(templateName("")).toBeNull();
  });

  it("classifies WhatsApp error codes", () => {
    expect(classifyMetaError(400, { error: { code: 131047 } })).toBe("window");
    expect(classifyMetaError(400, { error: { code: 130429 } })).toBe("rate");
    expect(classifyMetaError(400, { error: { code: 131026 } })).toBe("gone");
    expect(classifyMetaError(401, { error: { code: 190 } })).toBe("token");
  });
});
