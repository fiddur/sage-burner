import webpush from 'web-push'

import type { Delivery, VapidKeys } from './push.ts'

/**
 * The one place that talks to a push service.
 *
 * Kept apart from `push.ts` so everything else about notifications is testable:
 * delivery needs a real browser to produce a subscription and a real push service
 * to accept one, so the suite injects a spy and this module is what production
 * passes instead.
 *
 * `web-push` rather than hand-rolled crypto. VAPID signing is a JWT, but the
 * payload is RFC 8291 — ECDH to the browser's key, HKDF, then AES-128-GCM — and a
 * subtle mistake there fails as "notifications silently do not arrive", which is
 * the hardest possible thing to notice. This is the one dependency where the
 * alternative is worse.
 */
/**
 * The `mailto:` a push service complains to before it blocks us.
 *
 * Required by VAPID and deliberately not configurable: an installation that had to
 * set this would be an installation `docker compose up` is not sufficient for. It
 * points at the project rather than at any member, which is also the right answer
 * for privacy — the alternative is publishing an organiser's address to Google.
 */
export const DEFAULT_PUSH_CONTACT = 'mailto:noreply@sage-burner.invalid'

/** `web-push`'s own generator, wrapped so `app.ts` need not import the library. */
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
          // A `mailto:` the push service can complain to. Required by VAPID, and
          // the reason it is the admin contact rather than a made-up address: a
          // service that decides we are misbehaving will use it before blocking.
          vapidDetails: { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey },
          // Short, because nobody wants yesterday's application. The push service
          // drops it rather than holding it for a phone that is off.
          TTL: 60 * 60,
        },
      )

      return 'sent'
    } catch (failure) {
      // 404 and 410 are the push service saying the browser threw this
      // subscription away. Anything else — a 500, a timeout, a DNS failure — is
      // theirs and might work next time, so the row stays.
      const status = failure instanceof webpush.WebPushError ? failure.statusCode : undefined

      return status === 404 || status === 410 ? 'gone' : 'failed'
    }
  }
