import type { Metadata } from "next";
import { Updated, Lead, H2, P, UL, LI, Strong, InLink, ExtLink } from "../prose";

export const metadata: Metadata = {
  title: "Terms of Service · Gituas",
  description: "The terms that govern your use of Gituas.",
};

export default function TermsPage() {
  return (
    <article>
      <h1 className="font-display text-4xl md:text-5xl leading-tight">Terms of Service</h1>
      <Updated date="June 8, 2026" />

      <Lead>
        These Terms govern your access to and use of Gituas. By creating an account or using the
        service, you agree to these Terms.
      </Lead>

      <H2>1. The service</H2>
      <P>
        Gituas is an autonomous marketing and operations platform. It connects to your code
        repository and to social and payment accounts you authorize, and uses AI to plan, create,
        schedule, and publish marketing content on your behalf, subject to the controls and
        approvals you configure.
      </P>

      <H2>2. Eligibility and accounts</H2>
      <UL>
        <LI>You must be at least 16 years old and able to form a binding contract.</LI>
        <LI>You are responsible for safeguarding your account and for all activity under it.</LI>
        <LI>You must provide accurate information and keep it current.</LI>
      </UL>

      <H2>3. Connected third-party accounts</H2>
      <P>
        When you connect a platform such as TikTok, X, LinkedIn, Reddit, Meta, or Stripe, you
        authorize Gituas to act on your behalf within the scopes you grant. You remain bound by each
        platform&rsquo;s own terms — including the{" "}
        <ExtLink href="https://www.tiktok.com/legal/page/global/terms-of-service/en">
          TikTok Terms of Service
        </ExtLink>
        {" "}— and you are responsible for ensuring your use of Gituas complies with them. You can
        revoke access at any time by disconnecting the platform in your dashboard.
      </P>

      <H2>4. Your content</H2>
      <P>
        You retain ownership of the content you provide and of the marketing content generated for
        you. You grant Gituas the limited rights needed to store, process, and publish that content
        to the destinations you authorize. You are responsible for the content that is published
        through your account and for ensuring it is lawful and accurate.
      </P>

      <H2>5. Acceptable use</H2>
      <P>You agree not to use Gituas to:</P>
      <UL>
        <LI>Violate any law or any connected platform&rsquo;s rules, including spam and platform-manipulation policies.</LI>
        <LI>Publish content that is unlawful, deceptive, infringing, or harmful.</LI>
        <LI>Attempt to access other users&rsquo; data, or to disrupt or reverse-engineer the service.</LI>
      </UL>

      <H2>6. AI-generated output</H2>
      <P>
        Marketing content is produced with the help of automated systems and may contain errors. You
        are responsible for reviewing content before it is published, and Gituas provides approval
        controls to help you do so. We make no warranty regarding the accuracy or performance of
        generated content.
      </P>

      <H2>7. Fees</H2>
      <P>
        If a paid plan applies, the fees, billing cycle, and refund terms will be presented to you
        before purchase. Failure to pay may result in suspension of the service.
      </P>

      <H2>8. Disclaimers</H2>
      <P>
        The service is provided &ldquo;as is&rdquo; without warranties of any kind, to the maximum
        extent permitted by law. We do not warrant that the service will be uninterrupted,
        error-free, or that it will achieve any particular marketing result.
      </P>

      <H2>9. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, Gituas will not be liable for any indirect,
        incidental, special, or consequential damages, or for lost profits, revenues, or data,
        arising from your use of the service.
      </P>

      <H2>10. Termination</H2>
      <P>
        You may stop using Gituas and delete your account at any time. We may suspend or terminate
        access if you breach these Terms or use the service in a way that risks harm to Gituas, its
        users, or any connected platform.
      </P>

      <H2>11. Changes</H2>
      <P>
        We may update these Terms as the service evolves. We will revise the &ldquo;Last
        updated&rdquo; date and, for material changes, provide notice in-app or by email. Continued
        use after changes take effect constitutes acceptance.
      </P>

      <H2>12. Contact</H2>
      <P>
        Questions about these Terms: <ExtLink href="mailto:support@gituas.app">support@gituas.app</ExtLink>.
        See also our <InLink href="/privacy">Privacy Policy</InLink>.
      </P>
    </article>
  );
}
