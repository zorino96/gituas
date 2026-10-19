import { describe, expect, it } from "vitest";

import type { ChatAttachment } from "@/lib/chat/types";
import { addToTray, hasRoom, isUploadable, MAX_FILES, pastedFiles } from "@/app/app/assistant/chat-files";

const file = (n: number): ChatAttachment => ({ id: `a${n}`, url: `https://x/${n}.jpg`, pathname: `merchant/w/chat/${n}.jpg`, kind: "image", name: `${n}.jpg` });
const picked = (type: string) => ({ type }) as File;

describe("files waiting in the tray", () => {
  it("keeps what every overlapping upload adds, instead of the last one overwriting the others", () => {
    // Three photos dropped, and one more pasted while they upload: the files arrive in any order, each put into the one tray.
    let tray: ChatAttachment[] = [];
    for (const n of [1, 4, 2, 3]) tray = addToTray(tray, file(n));
    expect(tray.map((f) => f.id)).toEqual(["a1", "a4", "a2", "a3"]);
  });

  it("never holds more than six, and never the same stored file twice", () => {
    let tray: ChatAttachment[] = [];
    for (let n = 1; n <= 9; n++) tray = addToTray(tray, file(n));
    expect(tray).toHaveLength(MAX_FILES);
    expect(addToTray(tray.slice(0, 2), file(1))).toHaveLength(2);
    expect(addToTray(tray.slice(0, 2), { ...file(7), pathname: file(1).pathname })).toHaveLength(2);
  });

  it("counts the files still on their way against the limit, so overlapping uploads cannot pass it", () => {
    expect(hasRoom(0, 0)).toBe(true);
    expect(hasRoom(3, 2)).toBe(true);
    expect(hasRoom(3, 3)).toBe(false);
    expect(hasRoom(6, 0)).toBe(false);
    expect(hasRoom(0, 6)).toBe(false);
  });
});

describe("pasting into the box", () => {
  it("makes a picture alone (a screenshot) an attachment", () => {
    const png = picked("image/png");
    expect(pastedFiles([png], "")).toEqual([png]);
    expect(pastedFiles([png], "   \n")).toEqual([png]);
  });

  it("pastes the text, and makes no attachment, when the copy carried text and a picture of it", () => {
    expect(pastedFiles([picked("image/png")], "Aram, 95,000, Erbil\nSara, 120,000, Sulaymaniyah")).toEqual([]);
  });

  it("ignores files the chat does not take", () => {
    expect(pastedFiles([picked("application/pdf"), picked("text/plain")], "")).toEqual([]);
    expect(isUploadable(picked("video/mp4"))).toBe(true);
    expect(isUploadable(picked("image/gif"))).toBe(false);
  });
});
