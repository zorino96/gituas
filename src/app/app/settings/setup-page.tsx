import { redirect } from "next/navigation";

import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { loadAccountLists, loadConnections, requireWorkspace } from "../data";
import { NewsSettings, type SetupSection } from "./news-settings";
import { loadNewsProps } from "./news-props";
import { SetupTabs } from "./setup-tabs";

/** One part of the newsroom's setup, on its own screen (Settings keeps the account: language, accounts, password). */
export async function SetupPage({ section, title }: { section: SetupSection; title: "sources" | "autopilot" | "videoSetup" | "brand" }) {
  const ws = await requireWorkspace();
  if (ws.kind !== "NEWS") redirect("/app");
  const t = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;
  const [conns, lists] = await Promise.all([loadConnections(ws.id), loadAccountLists(ws.id)]);
  const news = await loadNewsProps(ws, conns, lists);
  return (
    <div className="gm-narrow">
      <h2 className="gm-title kufi">{t.nr.shell.nav.items[title]}</h2>
      <SetupTabs current={title} />
      <NewsSettings {...news} section={section} />
    </div>
  );
}
