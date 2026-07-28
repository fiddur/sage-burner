import { describe, expect, it } from 'vitest'

import {
  accountRoles,
  applicationStatuses,
  formQuestionTypes,
  isAccountRole,
  isApplicationStatus,
  isFormQuestionType,
  isPaymentStatus,
  paymentStatuses,
} from './enums.ts'

describe('enum type guards', () => {
  const cases = [
    { name: 'account role', values: accountRoles, guard: isAccountRole },
    { name: 'application status', values: applicationStatuses, guard: isApplicationStatus },
    { name: 'form question type', values: formQuestionTypes, guard: isFormQuestionType },
    { name: 'payment status', values: paymentStatuses, guard: isPaymentStatus },
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
