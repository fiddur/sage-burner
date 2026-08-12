import { detailsPage } from '@sage-burner/shared'

import { isApiError } from './api/client.ts'
import { errorMessage } from './load.ts'

export const NEEDS_JOINING = 'You need to join this burn before you can take that on.'

export const NEEDS_JOINING_THEM = 'They need to join this burn before they can be put on that.'

export const notAttending = (failure: unknown): boolean =>
  isApiError(failure) && failure.code === 'not_attending'

export const joinFirst =
  (fallback: string, whose: 'mine' | 'theirs' = 'mine') =>
  (failure: unknown): string =>
    notAttending(failure)
      ? whose === 'mine'
        ? NEEDS_JOINING
        : NEEDS_JOINING_THEM
      : errorMessage(failure, fallback)

export const joinLink = (message: string | undefined): { href: string; label: string } | undefined =>
  message === NEEDS_JOINING ? { href: detailsPage(), label: 'Your details' } : undefined
