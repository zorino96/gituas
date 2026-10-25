"use client";

// The files waiting in the composer: pictures and videos go straight to storage through /api/app/upload (the same route and
// limits as the older assistant screen) and travel with the next message as ChatAttachment. The server gives them their real ids.

import { useCallback, useRef, useState } from "react";
import { upload } from "@/lib/upload-client";

import type { ChatAttachment } from "@/lib/chat/types";
import { useT } from "@/lib/i18n/client";
import { imageToJpeg } from "../publish/to-jpeg";
import { addToTray, hasRoom, IMAGES, MAX_BYTES, MAX_FILES, MB, VIDEOS } from "./chat-files";

export { ACCEPT, isUploadable, MAX_FILES, pastedFiles } from "./chat-files";

/** Sends one file to storage. The dev preview replaces it, because it has no session to upload with. */
export type PutFile = (pathname: string, file: File) => Promise<{ url: string; pathname: string }>;
const putToBlob: PutFile = (pathname, file) =>
  upload(pathname, file, { access: "public", handleUploadUrl: "/api/app/upload", contentType: file.type, multipart: file.size > 20 * MB });

export function useChatUploads(workspaceId: string, put: PutFile = putToBlob) {
  const all = useT();
  const u = all.assistant.upload;
  const [files, setFiles] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Several drops or pastes can be uploading at once. They all work on this one tray, as it is at the moment each file arrives
  // (a copy taken when a call started would overwrite what the others added), and "uploading" stays on until the last one is done.
  const tray = useRef<ChatAttachment[]>([]);
  const onTheWay = useRef(0);
  const calls = useRef(0);
  const named = useRef(0);
  // Ids are never reused in a chat: a card made for "a1" cannot end up pointing at another picture.
  const seq = useRef(0);
  const takeId = useCallback((): string | null => (seq.current >= 99 ? null : `a${++seq.current}`), []);

  const change = useCallback((next: (list: ChatAttachment[]) => ChatAttachment[]) => {
    const list = next(tray.current);
    tray.current = list;
    setFiles(list);
  }, []);

  const add = useCallback(
    async (picked: File[]) => {
      setError(null);
      calls.current++;
      setUploading(true);
      try {
        for (const raw of picked) {
          if (!hasRoom(tray.current.length, onTheWay.current)) {
            setError(u.full);
            break;
          }
          const isImage = !!IMAGES[raw.type];
          if (!isImage && !VIDEOS[raw.type]) {
            setError(u.badType);
            continue;
          }
          if (raw.size > MAX_BYTES) {
            setError(u.tooBig(MAX_BYTES / MB));
            continue;
          }
          onTheWay.current++;
          try {
            // Instagram takes only JPEG: every picture goes up as one.
            const file = isImage && raw.type !== "image/jpeg" ? await imageToJpeg(raw, all.publish) : raw;
            const ext = isImage ? "jpg" : VIDEOS[file.type];
            const blob = await put(`merchant/${workspaceId}/chat/${Date.now()}-${++named.current}.${ext}`, file);
            const id = takeId();
            if (!id) break;
            const item: ChatAttachment = { id, url: blob.url, pathname: blob.pathname, kind: isImage ? "image" : "video", name: raw.name.slice(0, 80) || (isImage ? "image.jpg" : "video") };
            change((list) => addToTray(list, item));
          } finally {
            onTheWay.current--;
          }
        }
      } catch {
        setError(u.failed);
      } finally {
        calls.current--;
        setUploading(calls.current > 0);
      }
    },
    [workspaceId, put, u, all.publish, takeId, change],
  );

  return {
    files,
    uploading,
    error,
    add,
    remove: (id: string) => change((list) => list.filter((f) => f.id !== id)),
    clear: () => {
      change(() => []);
      setError(null);
    },
    /** Files handed back after a turn that did not go through. */
    restore: (list: ChatAttachment[]) => change(() => list.slice(0, MAX_FILES)),
    setError,
  };
}

export type ChatUploads = ReturnType<typeof useChatUploads>;
