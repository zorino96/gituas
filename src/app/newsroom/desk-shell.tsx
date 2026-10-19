import "@/app/app/app.css";
import "./newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import { deleteThreadAction, listThreadsAction, pinThreadAction, renameThreadAction } from "@/app/app/assistant/chat-actions";
import { listWorkspaces, type Workspace } from "@/app/app/data";
import { newsroomAccess } from "@/lib/billing/trial";
import { newsChatEnabled } from "@/lib/chat/enabled";
import { db } from "@/lib/db";
import { dict, dirOf, getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { DeskFrame } from "./desk-frame";

/**
 * The newsroom's root element: the shop's design system, re-tokened by .nr.
 * Every screen inside it, the newsroom's own and the shop pages it re-exports
 * (comments, messages, publish, insights, settings), follows the gm_lang cookie.
 */
export async function NewsroomRoot({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <div className={`gm nr ${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <LangProvider lang={lang}>{children}</LangProvider>
    </div>
  );
}

/** Tells a newsroom how long its free trial has left, or that it is frozen (read-only) until a plan is bought. */
async function TrialBanner({ tenantId }: { tenantId: string }) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  if (!tenant) return null;
  const access = newsroomAccess(tenant, new Date());
  const t = dict(await getLang()).nr.shell.desk;
  if (access.reason === "trial" && access.daysLeft != null) {
    return (
      <p className="gm-note nr-trial">
        {t.trialLeft(access.daysLeft)}{" "}
        <a href="/newsroom/billing" className="gm-link">
          {t.choosePlan}
        </a>
      </p>
    );
  }
  if (access.reason === "frozen") {
    return (
      <p className="gm-note warn nr-trial">
        {t.frozen}{" "}
        <a href="/newsroom/billing" className="gm-link">
          {t.choosePlan}
        </a>
      </p>
    );
  }
  return null;
}

/**
 * A signed-in channel's frame (DeskFrame, a client component): the desk's sidebar, top bar with the "?" guide link and phone bar, or, on
 * the chat routes while the desk's chat is on, the chat frame. This part only gathers what the frames need.
 */
export async function DeskShell({ ws, children }: { ws: Workspace; children: React.ReactNode }) {
  const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen);
  const roles = dict(await getLang()).nr.team.roles.label;
  // The chat is for the people who may configure the desk, while NEWS_CHAT_ENABLED is on (a client component cannot read the env).
  const chat =
    newsChatEnabled() && can(ws.role, "configure")
      ? {
          api: { list: listThreadsAction, rename: renameThreadAction, pin: pinThreadAction, remove: deleteThreadAction },
          support: { url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY },
        }
      : null;
  return (
    <NewsroomRoot>
      <DeskFrame
        workspace={{ id: ws.id, name: ws.name }}
        desks={desks.map((d) => ({ id: d.id, name: d.name, role: roles[d.role] }))}
        roleLabel={roles[ws.role]}
        banner={<TrialBanner tenantId={ws.id} />}
        chat={chat}
      >
        {children}
      </DeskFrame>
    </NewsroomRoot>
  );
}
