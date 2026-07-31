import { describe, expect, it } from 'vitest'

import {
  accountRoles,
  applicationStatuses,
  formQuestionTypes,
  isAccountRole,
  isApplicationStatus,
  isFormQuestionType,
  isInviteStatus,
  isPaymentStatus,
  inviteStatusOf,
  inviteStatuses,
  paymentStatuses,
} from './enums.ts'

describe('enum type guards', () => {
  const cases = [
    { name: 'account role', values: accountRoles, guard: isAccountRole },
    { name: 'application status', values: applicationStatuses, guard: isApplicationStatus },
    { name: 'form question type', values: formQuestionTypes, guard: isFormQuestionType },
    { name: 'payment status', values: paymentStatuses, guard: isPaymentStatus },
    { name: 'invite status', values: inviteStatuses, guard: isInviteStatus },
  ]

  for (const { name, values, guard } of cases) {
    describe(name, () => {
      it('accepts every declared value', () => {
        for (const value of values) expect(guard(value)).toBe(true)
      })

      it('rejects unknown strings', () => {
        expect(guard('definitely-not-a-value')).toBe(false)
        expect(guard('')).toBe(false)
      })

      it('rejects non-strings, so JSON from the wire cannot sneak through', () => {
        for (const value of [null, undefined, 0, 1, true, {}, []]) expect(guard(value)).toBe(false)
      })
    })
  }

  it('distinguishes admins from members', () => {
    expect(isAccountRole('admin')).toBe(true)
    expect(isAccountRole('Admin')).toBe(false)
    expect(isAccountRole('superuser')).toBe(false)
  })
})

describe('inviteStatusOf', () => {
  const at = (iso: string) => new Date(iso)

  it('is outstanding while the expiry is still ahead', () => {
    expect(
      inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', used_at: null }, at('2026-07-31T23:59:59Z')),
    ).toBe('outstanding')
  })

  it('is expired once the expiry has passed', () => {
    expect(
      inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', used_at: null }, at('2026-08-01T00:00:01Z')),
    ).toBe('expired')
  })

  it('is expired exactly at the expiry, which is what the create route refuses', () => {
    // `POST /api/admin/invites` refuses an `expires_at` that is `<= now`, so an
    // invite minted at the boundary would be dead on arrival. The two comparisons
    // have to agree, and this is the edit that would silently break it.
    expect(
      inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', used_at: null }, at('2026-08-01T00:00:00Z')),
    ).toBe('expired')
  })

  it('is used whether or not the expiry has passed', () => {
    const used = { used_at: '2026-07-02T00:00:00Z' }
    expect(inviteStatusOf({ expires_at: '2026-08-01T00:00:00Z', ...used }, at('2026-07-03T00:00:00Z'))).toBe(
      'used',
    )
    expect(inviteStatusOf({ expires_at: '2026-07-01T00:00:00Z', ...used }, at('2026-08-03T00:00:00Z'))).toBe(
      'used',
    )
  })
})
