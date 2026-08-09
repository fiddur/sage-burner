import type { StoredImage } from '@sage-burner/shared'

import { apiRoutes, MAX_IMAGES_PER_ACCOUNT } from '@sage-burner/shared'
import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PicturesApi } from './PicturesField.tsx'

import { PicturesField } from './PicturesField.tsx'

afterEach(cleanup)

const anImage = (over: Partial<StoredImage> & Pick<StoredImage, 'id'>): StoredImage => ({
  created_at: '2026-08-01T10:00:00.000Z',
  ...over,
})

const stub = (over: Partial<PicturesApi> = {}, images: StoredImage[] = []): PicturesApi => ({
  getMyImages: () => Promise.resolve({ images }),
  removeMyImage: () => Promise.reject(new Error('removeMyImage is not stubbed here')),
  ...over,
})

describe('the pictures you have stored', () => {
  it('says so when there are none', async () => {
    render(<PicturesField api={stub()} />)

    expect(await screen.findByText(/have not added any yet/)).toBeTruthy()
  })

  it('says a failed load failed, rather than showing an empty grid', async () => {
    render(<PicturesField api={stub({ getMyImages: () => Promise.reject(new Error('offline')) })} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your pictures')
    expect(screen.queryByText(/have not added any yet/)).toBeNull()
  })

  it('draws each one through the route that serves it', async () => {
    render(<PicturesField api={stub({}, [anImage({ id: 'img-1' })])} />)

    const drawn = await waitFor(() => {
      const found = document.querySelector('.picture-grid img')
      if (found === null) throw new Error('no picture yet')
      return found
    })

    expect(drawn.getAttribute('src')).toBe(apiRoutes.storedImage.path('img-1'))
    // A phone's worth of photographs on one page, so nothing is fetched until it is near.
    expect(drawn.getAttribute('loading')).toBe('lazy')
  })

  it('says how many of the ceiling are held, which is what makes a full one legible', async () => {
    render(<PicturesField api={stub({}, [anImage({ id: 'img-1' }), anImage({ id: 'img-2' })])} />)

    expect(await screen.findByText(`2 of ${MAX_IMAGES_PER_ACCOUNT}`)).toBeTruthy()
  })

  it('takes one off and re-reads rather than guessing what is left', async () => {
    let held = [anImage({ id: 'img-1' })]
    const removeMyImage = vi.fn((id: string) => {
      held = held.filter((picture) => picture.id !== id)
      return Promise.resolve(undefined)
    })
    render(
      <PicturesField api={{ getMyImages: () => Promise.resolve({ images: [...held] }), removeMyImage }} />,
    )
    ;(await screen.findByRole('button', { name: /^Take off the picture/ })).click()

    expect(await screen.findByText(/have not added any yet/)).toBeTruthy()
    expect(removeMyImage).toHaveBeenCalledWith('img-1')
  })

  it('says a refused removal failed rather than leaving the grid looking taken off', async () => {
    render(
      <PicturesField
        api={stub({ removeMyImage: () => Promise.reject(new Error('nope')) }, [anImage({ id: 'img-1' })])}
      />,
    )
    ;(await screen.findByRole('button', { name: /^Take off the picture/ })).click()

    expect((await screen.findByRole('alert')).textContent).toContain('Could not take that picture off')
    expect(document.querySelectorAll('.picture-grid img')).toHaveProperty('length', 1)
  })

  it('warns that a removal leaves a gap, since nothing here can find the reference', async () => {
    // The markdown that points at a picture is in somebody's prose and no foreign key can
    // see it, so this is the person's decision to make rather than one the app can make.
    render(<PicturesField api={stub()} />)

    expect(await screen.findByText(/leaves a gap wherever it was still being shown/)).toBeTruthy()
  })
})
