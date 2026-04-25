import { Metadata } from 'next'
import { Trans } from '@lingui/react/macro'
import { setI18n } from '@lingui/react/server'
import { getLinguiInstance } from '@/lib/i18n/get-lingui-instance'
import { LangProps } from '@/types/lang-props'

export const generateMetadata = async (): Promise<Metadata> => {
  return {
    robots: 'noindex, nofollow',
  }
}

const PrivacyPolicy = async ({ params }: { params: Promise<LangProps> }) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)
  return (
    <div className='w-height flex w-full flex-col items-center bg-gray-50'>
      <div className='mb-20 flex w-full flex-col gap-y-4 px-4 py-8 lg:w-2/3 xl:w-3/5 2xl:w-2/5'>
        <h1 className='w-full text-4xl'>
          <Trans>1. Introduction</Trans>
        </h1>
        <p className='text-xl font-light'>
          <Trans>
            Welcome to TemplateApp.com. We are committed to protecting your privacy. This Privacy Policy outlines how we
            collect, handle, store, and safeguard your personal data as you interact with our services.
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>2. Information Collection</Trans>
        </h2>
        <div className='text-xl font-light'>
          <p>
            <Trans>
              - Personal Information: We collect personal data such as your name, email address, and other contact
              details when you register, subscribe to our services, fill out forms, or interact with our platform in
              other ways that require personal identification.
            </Trans>
          </p>
          <p>
            <Trans>
              - Voice Recordings: To assist in pronunciation improvement, we collect and analyze recordings of your
              voice. These are used to create personalized voice clones. - App data: We collect and store data that you
              input into the app for language learning purposes. This includes your learning progress, custom settings,
              and interactions within the app. This data is utilized to tailor and enhance your learning experience,
              enabling personalized language learning pathways and recommendations.
            </Trans>
          </p>
          <p className='text-xl font-light'>
            <Trans>
              - Cookies and Tracking Technologies: We use cookies and similar technologies to monitor and analyze
              service usage and to enhance user experience. You may control the use of these technologies through your
              browser settings.
            </Trans>
          </p>
          <p className='text-xl font-light'>
            <Trans>
              - Google/Apple/Email Authentication: We integrate industry standards to streamline your sign-in process
              and enhance account security. We might use your email address to send you notifications and emails, from
              which you can always unsubscribe. We do not sell your email address. We also do not share your email
              address with any third parties if it's not strictly related to the basic functioning of our webapp.
            </Trans>
          </p>
        </div>
        <h2 className='w-full text-4xl'>
          <Trans>3. Use of Information</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>The data we collect serves several purposes:</Trans>
        </p>
        <div className='text-xl font-light'>
          <p>
            <Trans>- To provide, operate, and maintain our services</Trans>
          </p>
          <p>
            <Trans>- To improve, personalize, and expand our services</Trans>
          </p>
          <p>
            <Trans>- To understand and analyze how you use our services</Trans>
          </p>
          <Trans>- To develop new products, services, features, and functionality</Trans>
          <p>
            <Trans>
              - To communicate with you, either directly or through one of our partners, including for customer service,
              to provide you with updates and other information relating to the service, and for marketing and
              promotional purposes
            </Trans>
          </p>
          <p>
            <Trans>- To send you emails and notifications</Trans>
          </p>
        </div>
        <h2 className='w-full text-4xl'>
          <Trans>4. Transfer of Data</Trans>
        </h2>

        <p className='text-xl font-light'>
          <Trans>
            Your information, including Personal Data, may be transferred to and maintained on computers located outside
            of your jurisdiction where data protection laws may differ from those in your jurisdiction.
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>5. Third-Party Services:</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>
            We engage reputable third-party companies to facilitate our services (&quot;Service Providers&quot;),
            provide the service on our behalf, perform service-related services, and assist in analyzing how our service
            is used. These third parties are carefully selected and have access to your Personal Data only to perform
            specific tasks on our behalf. They are contractually bound to maintain the confidentiality of your
            information and are committed to complying with applicable privacy laws, ensuring that your data is handled
            securely and responsibly.
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>6. Disclosure of Data</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>
            - Legal Requirements: We may disclose your data if required to do so by law or in response to valid requests
            by public authorities (e.g., a court or a government agency).
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>7. Security of Data</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>
            We implement and maintain robust security measures aligned with industry best practices to protect your
            Personal Data. Our security infrastructure includes:
          </Trans>
        </p>
        <div className='text-xl font-light'>
          <p>
            <Trans>- Enterprise-grade encryption protocols for data transmission and storage</Trans>
          </p>
          <p>
            <Trans>- Regular third-party security audits and penetration testing by certified specialists</Trans>
          </p>
          <p>
            <Trans>
              - Implementation of trusted, industry-standard security libraries and frameworks, avoiding custom security
              implementations
            </Trans>
          </p>
          <p>
            <Trans>- Strict access controls and authentication mechanisms following OWASP security guidelines</Trans>
          </p>
          <p>
            <Trans>- Continuous security monitoring and automated threat detection systems</Trans>
          </p>
          <p>
            <Trans>- Regular security training for our development and operations teams</Trans>
          </p>
        </div>
        <p className='text-xl font-light'>
          <Trans>
            Our security infrastructure is continuously monitored, evaluated, and enhanced to meet evolving
            cybersecurity challenges. We maintain rigorous standards in data protection and follow security best
            practices recommended by leading technology security organizations. For complete transparency, we
            acknowledge that all digital systems require ongoing vigilance, which is why we've implemented comprehensive
            monitoring and rapid response protocols.
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>8. Data Retention</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>
            We will retain your Personal Data only for as long as is necessary for the purposes set out in this Privacy
            Policy. We will retain and use your Personal Data to the extent necessary to comply with our legal
            obligations, resolve disputes, and enforce our legal agreements and policies.
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>9. Your Rights</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>
            We guarantee absolute control over your personal data through our automated account management system. Our
            platform provides a dedicated one-click deletion feature that ensures immediate and irreversible removal of
            all your data from our systems. When activated, this automated process permanently erases:
          </Trans>
        </p>
        <div className='mt-2 ml-8 text-xl font-light'>
          <p>
            <Trans>• Every voice recording and associated voice clone, without exception</Trans>
          </p>
          <p>
            <Trans>• Complete learning history and all accumulated progress data</Trans>
          </p>
          <p>
            <Trans>• All personal account information and system preferences</Trans>
          </p>
          <p>
            <Trans>• Full communication records and interaction history</Trans>
          </p>
        </div>
        <p className='mt-4 text-xl font-light'>
          <Trans>
            This automated deletion system is accessible 24/7 through your secure account dashboard. For additional
            assistance, our dedicated privacy team is available at contact@app-monorepo-template.dev to process your
            requests with the same level of immediacy and thoroughness.
          </Trans>
        </p>
        <h2 className='w-full text-4xl'>
          <Trans>10. Contact Us</Trans>
        </h2>
        <p className='text-xl font-light'>
          <Trans>
            If you have any questions about this Privacy Policy, please contact us via email:
            contact@app-monorepo-template.dev
          </Trans>
        </p>
      </div>
    </div>
  )
}

export default PrivacyPolicy
