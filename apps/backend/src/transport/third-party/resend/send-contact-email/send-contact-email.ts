import { Resend } from 'resend'
import { getConfig } from '../../../../config/environment-config'

const resend: Resend = new Resend(getConfig().resendApiKey)

export const sendContactEmail = async (
  username: string | undefined,
  email: string,
  message: string
): Promise<void> => {
  const nameDisplay = username ? `<p><strong>Name:</strong> ${username}</p>` : ''
  await resend.emails.send({
    from: 'Flicktionary <support@flicktionary.app>',
    to: ['support@flicktionary.app'],
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
}
