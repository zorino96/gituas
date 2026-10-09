import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Updated, Lead, H2, P, UL, LI, Strong, InLink, ExtLink } from "../prose";

export const metadata: Metadata = {
  title: "Data Deletion · Gituas",
  description: "How to delete your Gituas or Hawalnoos data: disconnect an account, or ask us to delete everything.",
};

const REQUEST = "mailto:hello@gituas.com?subject=Data%20Deletion%20Request";

/** The outcome of a deletion request Meta sent us, for the status link we gave Meta. */
async function requestStatus(code: string): Promise<Date | null> {
  if (!/^igdel_[a-z0-9]+_[A-Za-z0-9]{0,6}$/.test(code)) return null;
  const row = await db.auditLog.findFirst({
    where: { action: "integrations.data_deletion", metadata: { path: ["confirmationCode"], equals: code } },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const raw = (await searchParams).code;
  const code = typeof raw === "string" ? raw.slice(0, 64) : null;
  const doneAt = code ? await requestStatus(code) : null;
  return (
    <article>
      <h1 className="font-display text-4xl md:text-5xl leading-tight">Data Deletion</h1>
      <Updated date="October 10, 2026" />

      {code && (
        <div className="mt-8 rounded-lg border border-line p-5">
          <P>
            <Strong>Request {code}:</Strong>{" "}
            {doneAt
              ? `completed on ${doneAt.toISOString().slice(0, 10)}. The connected accounts and the comments and messages we stored from them were deleted.`
              : "we hold no stored data linked to this request. If you think we still hold your data, email us and we will check by hand."}
          </P>
        </div>
      )}

      <Lead>
        You can delete your Gituas or Hawalnoos data at any time. This page explains how, and exactly
        what gets removed.
      </Lead>

      <H2>Disconnect one account yourself</H2>
      <P>
        Open Settings, find the account under connected accounts, and choose{" "}
        <Strong>Disconnect</Strong>:
      </P>
      <UL>
        <LI>
          Gituas: <ExtLink href="https://gituas.com/app/settings">gituas.com/app/settings</ExtLink> for
          Facebook Pages, Instagram, TikTok and YouTube, and{" "}
          <ExtLink href="https://gituas.com/app/whatsapp">gituas.com/app/whatsapp</ExtLink> for your
          WhatsApp number.
        </LI>
        <LI>
          Hawalnoos:{" "}
          <ExtLink href="https://hawalnoos.com/newsroom/settings">hawalnoos.com/newsroom/settings</ExtLink>.
        </LI>
      </UL>
      <P>
        Disconnecting deletes the access tokens we hold for that account at once, together with the
        comments and messages we stored from it. For a YouTube channel, the links and ids of videos we
        uploaded are removed within 7 days. You can also remove our access from the platform itself
        (for example in Facebook&rsquo;s Business Integrations, Instagram&rsquo;s Apps and Websites, TikTok&rsquo;s
        Manage app permissions, or your{" "}
        <ExtLink href="https://myaccount.google.com/permissions">Google account permissions</ExtLink>
        ). The connection then stops working at once; disconnect it in Settings, or ask us, to delete
        the data we stored from it.
      </P>

      <H2>Delete your whole account</H2>
      <P>
        Send an email to <ExtLink href={REQUEST}>hello@gituas.com</ExtLink> from the email address on
        your account, with the subject &ldquo;Data Deletion Request&rdquo; and the name of your shop or
        news outlet. We confirm the request comes from you, then delete your account and all its data
        within 30 days, and within 7 days for YouTube data. If you can&rsquo;t sign in or no longer
        have access to that email, write to us anyway and we will help you prove the account is yours.
      </P>

      <H2>What we delete</H2>
      <UL>
        <LI>Your account profile (name, email, picture, and the sign-in IDs from Google or GitHub).</LI>
        <LI>
          All connected-account tokens and profile data: Facebook Pages, Instagram, TikTok, YouTube,
          WhatsApp, and on older plans X, LinkedIn and Reddit.
        </LI>
        <LI>Comments, direct messages and WhatsApp messages we stored from your accounts.</LI>
        <LI>Products, orders and buyer details in your shop.</LI>
        <LI>
          Drafts, captions, schedules, news cards, videos, and the photos and clips you uploaded.
        </LI>
        <LI>Logs containing your personal data, subject to the limited exceptions below.</LI>
      </UL>

      <H2>What may be retained</H2>
      <P>
        We may keep a minimal set of records where the law requires it, such as invoices for tax and
        accounting. They are kept only as long as required and are not used for any other purpose.
      </P>

      <H2>Removing data already published</H2>
      <P>
        Posts and videos already published to a platform (such as a video posted to TikTok or YouTube)
        live on that platform. To remove them, delete them there. Deleting your account stops any
        further publishing but does not remove posts the platform already hosts.
      </P>

      <H2>Confirmation</H2>
      <P>
        When deletion is complete, we confirm by email. If you have any questions, contact{" "}
        <ExtLink href="mailto:hello@gituas.com">hello@gituas.com</ExtLink>. See also our{" "}
        <InLink href="/privacy">Privacy Policy</InLink>.
      </P>
    </article>
  );
}
