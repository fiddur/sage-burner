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

import webpush from 'web-push'

import type { Delivery, VapidKeys } from './push.ts'

/**
 * The `mailto:` VAPID requires, at a TLD reserved to be unresolvable.
 *
 * A push service is meant to use this before blocking a misbehaving sender, and
 * this one cannot receive mail — a deliberate trade. Configuring it would make
 * `docker compose up` insufficient, and defaulting it to a real organiser's
 * address would publish that address to Google and Mozilla. Nobody has been
 * blocked yet; if that changes, this is the line to revisit.
 */
export const DEFAULT_PUSH_CONTACT = 'mailto:noreply@sage-burner.invalid'

/**
 * What a thrown delivery means for the row.
 *
 * Exported because it is the one piece of this module that is pure, and it decides
 * whether a subscription is **deleted** — `404` alone, forgetting `410`, would mean
 * dead endpoints retried on every application forever, and treating any failure as
 * `gone` would drop a phone over one bad night from Google.
 */
export const outcomeFor = (failure: unknown): 'gone' | 'failed' => {
  // 404 and 410 are the push service saying the browser threw this subscription
  // away. Anything else — a 500, a timeout, a DNS failure — is theirs and might
  // work next time, so the row stays.
  const status = failure instanceof webpush.WebPushError ? failure.statusCode : undefined

  return status === 404 || status === 410 ? 'gone' : 'failed'
}

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
          // Required by VAPID. `DEFAULT_PUSH_CONTACT` above is what this is and
          // why it is deliberately unreachable.
          vapidDetails: { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey },
          // Short, because nobody wants yesterday's application. The push service
          // drops it rather than holding it for a phone that is off.
          TTL: 60 * 60,
        },
      )

      return 'sent'
    } catch (failure) {
      return outcomeFor(failure)
    }
  }
