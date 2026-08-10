import webpush from 'web-push'

import type { Delivery, VapidKeys } from './push.ts'

export const DEFAULT_PUSH_CONTACT = 'mailto:noreply@sage-burner.invalid'

export const outcomeFor = (failure: unknown): 'gone' | 'failed' => {
  const status = failure instanceof webpush.WebPushError ? failure.statusCode : undefined

  return status === 404 || status === 410 ? 'gone' : 'failed'
}

export const generateVAPIDKeys = (): VapidKeys => webpush.generateVAPIDKeys()

export const deliverWithWebPush =
  (contact: string): Delivery =>
  async (subscription, payload, keys: VapidKeys) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        {
          vapidDetails: { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 60 * 60,
        },
      )

      return 'sent'
    } catch (failure) {
      return outcomeFor(failure)
    }
  }
