"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useT } from "@/lib/i18n/client";

type Target = "FB" | "IG" | "TT" | "YT";
const PARAM: Record<Target, string> = { FB: "fb", IG: "ig", TT: "tt", YT: "yt" };

/**
 * Which account a page shows, per platform, when the workspace connected several.
 * The choice lives in the address (?fb=…&ig=…) so the server loads that account's data.
 */
export function AccountSwitcher({
  lists,
  selected,
}: {
  lists: Partial<Record<Target, { id: string; name: string }[]>>;
  selected: Partial<Record<Target, string | undefined>>;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const shown = (Object.keys(lists) as Target[]).filter((tg) => (lists[tg]?.length ?? 0) > 1);
  if (!shown.length) return null;

  return (
    <div className="gm-row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      {shown.map((tg) => (
        <label key={tg} className="gm-row" style={{ gap: 6 }}>
          <small>{t.platform[tg]}</small>
          <select
            className="gm-input"
            style={{ width: "auto", padding: "6px 10px" }}
            value={selected[tg] ?? lists[tg]![0].id}
            onChange={(e) => {
              const next = new URLSearchParams(params.toString());
              next.set(PARAM[tg], e.target.value);
              router.push(`${path}?${next.toString()}`);
            }}
          >
            {lists[tg]!.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
