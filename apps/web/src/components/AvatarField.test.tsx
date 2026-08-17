import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { apiError } from '../api/client.ts'
import { ViewerProvider } from '../viewer.tsx'
import { AvatarField, messageForFailure } from './AvatarField.tsx'

afterEach(cleanup)

describe('why the picture did not go up', () => {
  it('sends nobody after their file when the session went', () => {
    const message = messageForFailure(apiError(401, 'unauthenticated', 'unauthenticated'))

    expect(message).toContain('signed out')
    expect(message).not.toContain('JPEG')
  })

  it('passes the network message through, connection advice and all', () => {
    expect(messageForFailure(apiError(0, 'network', 'Check your connection.'))).toBe('Check your connection.')
  })

  it('names the formats when the server refused the bytes', () => {
    expect(messageForFailure(apiError(415, 'bad_request', 'bad_request'))).toContain('JPEG')
  })

  it('names the formats when the browser could not read the file at all', () => {
    expect(messageForFailure(new Error('The source image cannot be decoded.'))).toContain('JPEG')
  })

  it('says nothing about formats for a server that simply fell over', () => {
    const message = messageForFailure(apiError(500, 'internal', 'internal'))

    expect(message).toContain('Please try again')
    expect(message).not.toContain('JPEG')
  })
})

describe('the field itself', () => {
  it('reports a picture the browser cannot read, rather than failing silently', async () => {
    render(
      <ViewerProvider
        viewer={{
          status: 'signed-in',
          account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
        }}
      >
        <AvatarField
          api={{
            setMyAvatar: () => Promise.resolve({ avatar: 'v1' }),
            removeMyAvatar: () => Promise.resolve(undefined),
          }}
        />
      </ViewerProvider>,
    )

    fireEvent.change(screen.getByLabelText('Your picture'), {
      target: { files: [new File(['not really a picture'], 'me.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('JPEG')
    })
  })
})
