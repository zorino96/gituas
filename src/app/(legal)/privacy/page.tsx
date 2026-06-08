import type { Metadata } from "next";
import { Updated, Lead, H2, P, UL, LI, Strong, InLink, ExtLink } from "../prose";

export const metadata: Metadata = {
  title: "Privacy Policy · Gituas",
  description: "How Gituas collects, uses, stores, and deletes your data.",
};

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="font-display text-4xl md:text-5xl leading-tight">Privacy Policy</h1>
      <Updated date="June 8, 2026" />

      <Lead>
        Gituas (&ldquo;Gituas,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is an autonomous
        marketing and operations platform for software makers. This policy explains what data we
        collect, why, how we protect it, and how you can delete it.
      </Lead>

      <H2>1. Who we are</H2>
      <P>
        Gituas connects to a maker&rsquo;s code repository and their social and payment accounts,
        then uses AI to plan, create, and publish marketing content on their behalf. We are the
        data controller for the information described below. For any privacy question, contact us
        at <ExtLink href="mailto:privacy@gituas.app">privacy@gituas.app</ExtLink>.
      </P>

      <H2>2. Information we collect</H2>
      <UL>
        <LI>
          <Strong>Account data.</Strong> When you sign in with GitHub, we receive your name, email
          address, avatar, and GitHub account ID.
        </LI>
        <LI>
          <Strong>Connected-platform credentials.</Strong> When you connect a third-party account
          (TikTok, X, LinkedIn, Reddit, Meta, Stripe, and similar), we receive and store the access
          and refresh tokens that platform issues. These are encrypted at rest (see &sect;6).
        </LI>
        <LI>
          <Strong>Platform profile data.</Strong> With your authorization, we read basic profile
          information from connected platforms — for example, your TikTok display name, avatar, and
          open ID — solely to confirm the connected account and attribute published content.
        </LI>
        <LI>
          <Strong>Repository data.</Strong> We read metadata and content from repositories you
          authorize (such as README, descriptions, releases, and languages) to understand your
          product and generate relevant marketing.
        </LI>
        <LI>
          <Strong>Content you and our agents create.</Strong> Drafts, captions, images, videos,
          schedules, and approvals generated within Gituas.
        </LI>
        <LI>
          <Strong>Usage and device data.</Strong> Log data such as IP address, browser type, and
          actions taken, used for security and reliability.
        </LI>
      </UL>

      <H2>3. How we use your information</H2>
      <UL>
        <LI>To provide the service: plan, generate, schedule, and publish content you approve.</LI>
        <LI>To publish to your connected accounts strictly within the scopes you grant.</LI>
        <LI>To operate, secure, debug, and improve the platform.</LI>
        <LI>To communicate with you about your account and service changes.</LI>
      </UL>
      <P>
        We do <Strong>not</Strong> sell your personal information, and we do not use platform data
        for advertising profiling or any purpose other than operating the features you enable.
      </P>

      <H2>4. TikTok and other connected platforms</H2>
      <P>
        When you connect TikTok, we access your data through the TikTok API only to (a) verify the
        connected account and (b) upload and publish videos and photo posts that you or your
        configured automations authorize. Our use and transfer of information received from TikTok
        adheres to the{" "}
        <ExtLink href="https://developers.tiktok.com/doc/tiktok-api-platform-terms">
          TikTok Developer Terms of Service
        </ExtLink>{" "}
        and applicable platform policies. We request only the scopes required for these features
        (such as <code className="text-fg">user.info.basic</code>,{" "}
        <code className="text-fg">video.upload</code>, and{" "}
        <code className="text-fg">video.publish</code>). The same principles apply to every other
        connected platform: least-privilege scopes, used only for the features you turn on.
      </P>

      <H2>5. How we share information</H2>
      <P>We share data only with service providers that help us run Gituas, including:</P>
      <UL>
        <LI><Strong>Hosting &amp; infrastructure</Strong> — Vercel (application) and Neon (database).</LI>
        <LI><Strong>AI processing</Strong> — Google (Gemini) to generate marketing content.</LI>
        <LI><Strong>Connected platforms</Strong> — TikTok, X, LinkedIn, Reddit, Meta, and Stripe, to which we send the content and requests you authorize.</LI>
      </UL>
      <P>
        We may also disclose information if required by law or to protect the rights, safety, and
        security of Gituas and its users. We never sell personal data.
      </P>

      <H2>6. Data storage and security</H2>
      <P>
        Data is stored on managed infrastructure in the United States and European Union. All
        third-party access tokens are encrypted at rest using AES-256-GCM before being written to
        the database, and are decrypted only in memory at the moment an action you authorized is
        performed. Access to production systems is restricted and logged.
      </P>

      <H2>7. Data retention</H2>
      <P>
        We keep your data for as long as your account is active. When you disconnect a platform, we
        delete the associated access tokens. When you delete your account, we delete your personal
        data and connected-platform data within 30 days, except where we must retain limited records
        to meet legal obligations.
      </P>

      <H2>8. Your rights and choices</H2>
      <UL>
        <LI>Access, correct, or export your personal data.</LI>
        <LI>Disconnect any platform at any time from your dashboard, which revokes our stored tokens.</LI>
        <LI>Delete your account and all associated data — see <InLink href="/data-deletion">Data Deletion</InLink>.</LI>
      </UL>
      <P>
        Depending on where you live, you may have additional rights under the GDPR or CCPA. To
        exercise any right, email <ExtLink href="mailto:privacy@gituas.app">privacy@gituas.app</ExtLink>.
      </P>

      <H2>9. Cookies</H2>
      <P>
        We use only essential cookies required to keep you signed in and to secure your session. We
        do not use advertising or cross-site tracking cookies.
      </P>

      <H2>10. Children</H2>
      <P>
        Gituas is not directed to anyone under 16, and we do not knowingly collect data from
        children. If you believe a child has provided us data, contact us and we will delete it.
      </P>

      <H2>11. Changes to this policy</H2>
      <P>
        We may update this policy as the service evolves. We will revise the &ldquo;Last
        updated&rdquo; date above and, for material changes, notify you in-app or by email.
      </P>

      <H2>12. Contact</H2>
      <P>
        Questions or requests: <ExtLink href="mailto:privacy@gituas.app">privacy@gituas.app</ExtLink>.
        See also our <InLink href="/terms">Terms of Service</InLink> and{" "}
        <InLink href="/data-deletion">Data Deletion</InLink> instructions.
      </P>
    </article>
  );
}
