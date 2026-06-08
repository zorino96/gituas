import type { Metadata } from "next";
import { Updated, Lead, H2, P, UL, LI, Strong, InLink, ExtLink } from "../prose";

export const metadata: Metadata = {
  title: "Data Deletion · Gituas",
  description: "How to delete your Gituas account and all associated data.",
};

export default function DataDeletionPage() {
  return (
    <article>
      <h1 className="font-display text-4xl md:text-5xl leading-tight">Data Deletion</h1>
      <Updated date="June 8, 2026" />

      <Lead>
        You can delete your Gituas data at any time. This page explains exactly what gets removed and
        how to request it.
      </Lead>

      <H2>Delete from your dashboard</H2>
      <UL>
        <LI>
          <Strong>Disconnect a single platform.</Strong> Go to{" "}
          <InLink href="/dashboard/integrations">Dashboard → Integrations</InLink>, choose the
          platform (e.g. TikTok), and select <Strong>Disconnect</Strong>. This immediately deletes
          the access and refresh tokens we hold for that platform.
        </LI>
        <LI>
          <Strong>Delete your whole account.</Strong> Go to{" "}
          <InLink href="/dashboard/settings">Dashboard → Settings</InLink> and choose{" "}
          <Strong>Delete account</Strong>. This removes your account and all associated data.
        </LI>
      </UL>

      <H2>Request deletion by email</H2>
      <P>
        Prefer email, or can&rsquo;t sign in? Send a request to{" "}
        <ExtLink href="mailto:privacy@gituas.app?subject=Data%20Deletion%20Request">
          privacy@gituas.app
        </ExtLink>{" "}
        from the email address on your account, with the subject &ldquo;Data Deletion Request.&rdquo;
        We will verify your identity and complete the deletion within 30 days.
      </P>

      <H2>What we delete</H2>
      <UL>
        <LI>Your account profile (name, email, avatar, GitHub ID).</LI>
        <LI>All connected-platform access and refresh tokens, including TikTok, X, LinkedIn, Reddit, Meta, and Stripe.</LI>
        <LI>Repository data, generated content, drafts, schedules, and approvals tied to your account.</LI>
        <LI>Logs containing your personal data, subject to the limited exceptions below.</LI>
      </UL>

      <H2>What may be retained</H2>
      <P>
        We may retain a minimal set of records where we are legally required to (for example,
        transaction records for tax and accounting). Such records are kept only as long as required
        and are not used for any other purpose.
      </P>

      <H2>Removing data already published</H2>
      <P>
        Content that was already published to a third-party platform (such as a video posted to
        TikTok) lives on that platform. To remove it there, delete the post within that platform, or
        revoke Gituas&rsquo;s access in the platform&rsquo;s own app settings. Deleting your Gituas
        account stops any further publishing but does not retroactively remove posts the platform
        already hosts.
      </P>

      <H2>Confirmation</H2>
      <P>
        When deletion is complete, we will confirm by email. If you have any questions, contact{" "}
        <ExtLink href="mailto:privacy@gituas.app">privacy@gituas.app</ExtLink>. See also our{" "}
        <InLink href="/privacy">Privacy Policy</InLink>.
      </P>
    </article>
  );
}
