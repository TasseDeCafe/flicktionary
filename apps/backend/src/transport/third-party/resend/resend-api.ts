import { mockSendContactEmail } from './send-contact-email/mock-send-contact-email'
import { sendContactEmail } from './send-contact-email/send-contact-email'

export interface ResendApi {
  sendContactEmail: (username: string | undefined, email: string, message: string) => Promise<boolean>
}

export const RealResendApi: ResendApi = {
  sendContactEmail,
}

export const MockResendApi: ResendApi = {
  sendContactEmail: mockSendContactEmail,
}
