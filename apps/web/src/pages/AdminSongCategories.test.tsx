import type { SongCategory } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { SongCategoriesApi } from './AdminSongCategories.tsx'

import { ViewerProvider } from '../viewer.tsx'
import { AdminSongCategories } from './AdminSongCategories.tsx'

afterEach(cleanup)

const ORGANISER: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Org', avatar: null, roles: ['admin'] },
}

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-2', name: 'Ada', avatar: null, roles: ['member'] },
}

const CHANT: SongCategory = { id: 'c-1', order: 0, label: 'Chant' }
const SONG: SongCategory = { id: 'c-2', order: 1, label: 'Song' }

const stub = (
  over: Partial<SongCategoriesApi> = {},
  categories: SongCategory[] = [CHANT, SONG],
): SongCategoriesApi => ({
  getSongCategories: () => Promise.resolve({ categories }),
  addSongCategory: () => Promise.reject(new Error('addSongCategory is not stubbed here')),
  updateSongCategory: () => Promise.reject(new Error('updateSongCategory is not stubbed here')),
  deleteSongCategory: () => Promise.reject(new Error('deleteSongCategory is not stubbed here')),
  reorderSongCategories: () => Promise.reject(new Error('reorderSongCategories is not stubbed here')),
  ...over,
})

const renderPage = (api: SongCategoriesApi, viewer: Viewer = ORGANISER) =>
  render(
    <ViewerProvider viewer={viewer}>
      <AdminSongCategories api={api} />
    </ViewerProvider>,
  )

describe('curating what a song can be filed under', () => {
  it('lists the categories', async () => {
    renderPage(stub())

    expect(await screen.findByText('Chant')).toBeTruthy()
    expect(screen.getByText('Song')).toBeTruthy()
  })

  it('adds one', async () => {
    const addSongCategory = vi.fn<SongCategoriesApi['addSongCategory']>(() =>
      Promise.resolve({ category: { id: 'c-3', order: 2, label: 'Round' } }),
    )
    renderPage(stub({ addSongCategory }))

    fireEvent.input(await screen.findByLabelText('Add a category'), { target: { value: '  Round  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(addSongCategory).toHaveBeenCalledWith({ label: 'Round' }))
  })

  it('renames one', async () => {
    const updateSongCategory = vi.fn<SongCategoriesApi['updateSongCategory']>(() =>
      Promise.resolve({ category: { ...CHANT, label: 'Chants' } }),
    )
    renderPage(stub({ updateSongCategory }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Chant' }))
    fireEvent.input(screen.getByLabelText('Rename Chant'), { target: { value: 'Chants' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSongCategory).toHaveBeenCalledWith('c-1', { label: 'Chants' }))
  })

  it('removes one', async () => {
    const deleteSongCategory = vi.fn<SongCategoriesApi['deleteSongCategory']>(() =>
      Promise.resolve(undefined),
    )
    renderPage(stub({ deleteSongCategory }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Song' }))
    fireEvent.click(screen.getByRole('button', { name: 'Really remove Song' }))

    await waitFor(() => expect(deleteSongCategory).toHaveBeenCalledWith('c-2'))
  })

  it('is not a page for a member without admin', () => {
    renderPage(stub(), ADA)

    expect(screen.queryByLabelText('Add a category')).toBeNull()
  })
})
