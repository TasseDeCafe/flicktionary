// Static legal page — intentionally English-only and not Lingui-wrapped:
// the privacy policy is a single canonical document (linked from the Chrome
// Web Store listing), and machine-translated legal text could drift from the
// authoritative wording.

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className='space-y-3'>
    <h2 className='text-xl font-semibold'>{title}</h2>
    {children}
  </section>
)

export const PrivacyPolicyView = () => (
  <main className='mx-auto max-w-3xl space-y-8 px-6 py-12 text-gray-800'>
    <header className='space-y-2'>
      <h1 className='text-3xl font-bold'>Flicktionary Privacy Policy</h1>
      <p className='text-sm text-gray-500'>Last updated: June 3, 2026</p>
    </header>

    <Section title='1. Introduction'>
      <p>
        Flicktionary (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a language-learning service consisting of the web app at
        flicktionary.app and a companion browser extension. We are committed to protecting your privacy. This policy
        explains what data we collect, how we use it, and the choices you have.
      </p>
    </Section>

    <Section title='2. Information we collect'>
      <ul className='list-disc space-y-2 pl-6'>
        <li>
          <strong>Account information.</strong> Your email address and, depending on how you sign in (Google, Apple, or
          email), your name. Authentication is handled by our infrastructure provider Supabase; we never see or store
          your passwords for third-party sign-in providers.
        </li>
        <li>
          <strong>Learning content.</strong> The words and phrases you save, the notes and highlights you make, the text
          you import or paste (for example subtitles of a video you watch or an article you import), titles and URLs of
          the videos and articles you save words from, your native language, the languages you study, and your
          proficiency levels.
        </li>
        <li>
          <strong>Usage data.</strong> How you interact with the service (pages viewed, features used) collected through
          analytics, and diagnostic data such as error reports.
        </li>
        <li>
          <strong>Payment information.</strong> If you purchase a subscription, payment is processed by Stripe. We
          receive your subscription status but never see or store your card details.
        </li>
        <li>
          <strong>Cookies and local storage.</strong> Used to keep you signed in and to remember your settings. We do
          not use advertising cookies.
        </li>
      </ul>
    </Section>

    <Section title='3. The browser extension'>
      <p>
        The Flicktionary browser extension only transmits data when you explicitly use one of its features: when you
        look up or save a subtitle word or phrase, it sends the selected text, the surrounding subtitle line, and the
        video&rsquo;s title and URL to our servers; when you import an article, it sends that article&rsquo;s text and
        URL. The extension stores your settings and your session token locally in your browser. It does not track your
        browsing history, does not read pages you visit beyond the features described above, and collects nothing
        without an explicit action from you.
      </p>
    </Section>

    <Section title='4. How we use your information'>
      <ul className='list-disc space-y-2 pl-6'>
        <li>
          To provide the service: the content you save is processed, including by AI language-model providers (such as
          Anthropic), to generate the definitions, explanations, and study material you request.
        </li>
        <li>To personalize the service to your languages, level, and preferences.</li>
        <li>To process payments and manage subscriptions.</li>
        <li>To understand how the service is used and improve it.</li>
        <li>To respond to your support requests and send you information relating to the service.</li>
      </ul>
    </Section>

    <Section title='5. Third-party service providers'>
      <p>
        We use a small number of service providers to operate Flicktionary: Supabase (authentication, database, and
        hosting), Stripe (payments), Anthropic (AI processing of the learning content you submit), PostHog (product
        analytics), Sentry (error monitoring), and Resend (transactional email). These providers process data only to
        provide their services to us and are bound by their own confidentiality and data-protection obligations. We do
        not sell your personal data to anyone.
      </p>
    </Section>

    <Section title='6. Transfer of data'>
      <p>
        Your information may be transferred to and processed on servers located outside of your state, province, or
        country, where data protection laws may differ from those in your jurisdiction. We take steps to ensure your
        data is treated securely and in accordance with this policy wherever it is processed.
      </p>
    </Section>

    <Section title='7. Disclosure of data'>
      <p>
        We may disclose your personal data where required to do so by law or in response to valid requests by public
        authorities.
      </p>
    </Section>

    <Section title='8. Security'>
      <p>
        We use industry-standard measures to protect your data, including encryption in transit, access controls, and
        monitoring. No method of transmission or storage is 100% secure, but we work to protect your personal data
        proportionately to its sensitivity.
      </p>
    </Section>

    <Section title='9. Data retention'>
      <p>
        We retain your data for as long as your account exists or as needed to provide the service and comply with our
        legal obligations. When you delete your account, your personal data is permanently removed.
      </p>
    </Section>

    <Section title='10. Your rights'>
      <p>
        You can access and update your learning content and settings directly in the app at any time. You can delete
        your account from your profile settings, which permanently and irreversibly removes your account information and
        learning data. Depending on where you live, you may also have rights to request access to, correction of, or a
        copy of your personal data — contact us and we will honor these requests.
      </p>
    </Section>

    <Section title='11. Changes to this policy'>
      <p>
        We may update this policy from time to time. We will post any changes on this page and update the &ldquo;Last
        updated&rdquo; date above.
      </p>
    </Section>

    <Section title='12. Contact us'>
      <p>
        Questions about this policy or your data? Email us at{' '}
        <a className='text-blue-600 underline' href='mailto:support@flicktionary.app'>
          support@flicktionary.app
        </a>
        .
      </p>
    </Section>
  </main>
)
