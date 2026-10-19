// Which files the chat takes, and how the tray of waiting files changes. Pure, so it is tested in node (tests/chat/ui-files.test.ts).

import type { ChatAttachment } from "@/lib/chat/types";

export const MB = 1024 * 1024;
export const MAX_FILES = 6;
export const MAX_BYTES = 40 * MB;
export const IMAGES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const VIDEOS: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
export const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";

export const isUploadable = (file: Pick<File, "type">): boolean => !!IMAGES[file.type] || !!VIDEOS[file.type];

/**
 * The files a paste turns into attachments. A paste that carries text as well (cells copied from a sheet, text copied from a
 * document, both of which often bring a picture of themselves along) is a paste of that text: the box takes it and no file is
 * made. A picture alone (a screenshot) has no text and becomes an attachment.
 */
export function pastedFiles<T extends Pick<File, "type">>(files: T[], text: string): T[] {
  return text.trim() ? [] : files.filter(isUploadable);
}

/** A file put in the tray: never past the limit, never twice (the same stored file is not listed again). */
export function addToTray(list: ChatAttachment[], file: ChatAttachment, max = MAX_FILES): ChatAttachment[] {
  if (list.length >= max || list.some((f) => f.id === file.id || f.pathname === file.pathname)) return list;
  return [...list, file];
}

/** Whether one more file may start uploading: the ones in the tray and the ones still on their way both hold a place. */
export const hasRoom = (inTray: number, onTheWay: number, max = MAX_FILES): boolean => inTray + onTheWay < max;
