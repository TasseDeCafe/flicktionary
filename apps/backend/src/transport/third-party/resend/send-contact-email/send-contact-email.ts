import { Resend } from 'resend'
import { getConfig } from '../../../../config/environment-config'
import { logCustomErrorMessageAndError } from '../../sentry/error-monitoring'

const resend: Resend = new Resend(getConfig().resendApiKey)

export const sendContactEmail = async (
  username: string | undefined,
  email: string,
  message: string
): Promise<boolean> => {
  try {
    const nameDisplay = username ? `<p><strong>Name:</strong> ${username}</p>` : ''
    await resend.emails.send({
      from: 'TemplateApp <support@app-monorepo-template.dev>',
      to: ['support@app-monorepo-template.dev'],
      replyTo: [email],
      subject: 'New message from your contact form',
      html: `
        <p>You have received a new message from your contact form:</p>
        ${nameDisplay}
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
    })
    return true
  } catch (error) {
    logCustomErrorMessageAndError(
      `sendContactEmail - error, email - ${email}, message - ${message}, username - ${username}`,
      error
    )
    return false
  }
}
