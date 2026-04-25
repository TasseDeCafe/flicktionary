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

const TermsAndConditions = async ({ params }: { params: Promise<LangProps> }) => {
  const { lang } = await params
  const { i18n } = await getLinguiInstance(lang)
  setI18n(i18n)
  return (
    <div className='w-height flex w-full flex-col items-center bg-gray-50'>
      <div className='mb-20 flex w-full flex-col gap-y-4 px-4 py-8 lg:w-2/3 xl:w-3/5 2xl:w-2/5'>
        <h1 className='w-full text-4xl'>
          <Trans>1. Agreement to Terms</Trans>
        </h1>
        <p>
          <Trans>
            By accessing and using our website, TemplateApp.com, and any associated services, you agree to be bound by
            these Terms of Service (&quot;Terms&quot;).
          </Trans>
        </p>
        <h1 className='w-full text-4xl'>
          <Trans>2. Intellectual Property Rights</Trans>
        </h1>
        <p className='text-xl font-light'>
          <Trans>
            The content, features, and functionality of our services, including but not limited to text, graphics,
            logos, images, as well as the design, selection, and arrangement thereof, are and will remain the exclusive
            property of TemplateApp.com and its licensors. These are protected by copyright, trademark, and other
            intellectual property or proprietary rights laws.
          </Trans>
        </p>
        <h1 className='w-full text-4xl'>
          <Trans>3. User Responsibilities</Trans>
        </h1>
        <div className='text-xl font-light'>
          <p>
            <Trans>
              - Voice Recording: Users may not use the service to replicate or clone voices of any individuals other
              than
            </Trans>
          </p>
          <p>
            <Trans>
              themselves. Each user must have the legal right to use all the voice data they upload to our platform.
            </Trans>
          </p>
          <p>
            <Trans>- Prohibited Activities: Users are prohibited from:</Trans>
          </p>
          <p>
            <Trans>
              - Engaging in any activity that disrupts or interferes with our resources, including servers and networks.
            </Trans>
          </p>
          <p>
            <Trans>- Attempting to copy, duplicate, reproduce, sell, trade, or resell our resources.</Trans>
          </p>
          <p>
            <Trans>
              - Accessing the service for any illegal purpose or in violation of any local, state, national, or
              international law.
            </Trans>
          </p>
          <p>
            <Trans>
              - Conducting any unauthorized activity that involves the service, including but not limited to data theft,
              providing malware or spyware, phishing, and other fraudulent activities.
            </Trans>
          </p>
          <p>
            <Trans>
              - Attempting to hack, destabilize, or introduce malicious software to our website, or to compromise the
              security of our services in any way.
            </Trans>
          </p>
        </div>
        <h1 className='w-full text-4xl'>
          <Trans>4. User Content</Trans>
        </h1>
        <div>
          <Trans>
            Users retain all rights to any content they upload, submit, post, or display on or through the service. By
            uploading this content, users grant us a permission to use, reproduce, modify, publish, and display this
            content in connection with the service. In particular, this content will neither be sold or traded with any
            external service provider nor made public without user&quot;s explicit consent
          </Trans>
        </div>
        <h1 className='w-full text-4xl'>
          <Trans>5. Account Termination</Trans>
        </h1>
        <p className='text-xl font-light'>
          <Trans>
            We may terminate or suspend your account immediately, without prior notice or liability, for any reason
            whatsoever, including without limitation if you breach these Terms. Upon termination, your right to use the
            service will cease immediately.
          </Trans>
        </p>
        <h1 className='w-full text-4xl'>
          <Trans>6. Disclaimer of Warranties</Trans>
        </h1>
        <p className='text-xl font-light'>
          <Trans>
            You understand and agree that your use of our service is at your sole risk. The service is provided on an
            &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis. We expressly disclaim all warranties, whether express
            or implied, including, but not limited to, the implied warranties of merchantability, fitness for a
            particular purpose, and non-infringement.
          </Trans>
        </p>
        <h1 className='w-full text-4xl'>
          <Trans>7. Limitation of Liability</Trans>
        </h1>
        <div className='text-xl font-light'>
          <Trans>
            In no event shall TemplateApp.com, nor its directors, employees, partners, agents, suppliers, or affiliates,
            be liable for any indirect, incidental, special, consequential, or punitive damages, including without
            limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from:
          </Trans>
          <p>
            <Trans>(i) your access to or use of or inability to access or use the service;</Trans>
          </p>
          <p>
            <Trans>(ii) any conduct or content of any third party on the service;</Trans>
          </p>
          <p>
            <Trans>(iii) any content obtained from the service; and</Trans>
          </p>
          <p>
            <Trans>
              (iv) unauthorized access, use, or alteration of your transmissions or content, whether based on warranty,
              contract, tort (including negligence), or any other legal theory, whether or not we have been informed of
              the possibility of such damage.
            </Trans>
          </p>
        </div>
        <h1 className='w-full text-4xl'>
          <Trans>8. Contact Us</Trans>
        </h1>
        <div>
          <Trans>
            If you have any questions about these Terms of Service, please contact us via email
            contact@app-monorepo-template.dev
          </Trans>
        </div>
      </div>
    </div>
  )
}

export default TermsAndConditions
