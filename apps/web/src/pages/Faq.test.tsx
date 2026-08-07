import type { FaqEntry, MyBurn } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { FaqApi } from './Faq.tsx'

import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Faq } from './Faq.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: null, avatar: null, roles: ['member'] },
}

const BURN = {
  id: 'e-1',
  name: 'Summer burn',
  slug: 'summer-burn',
  start_date: '2026-08-01',
  end_date: '2026-08-05',
  start_time: '16:00',
  end_time: '12:00',
  location: '',
  welcome_markdown: '',
  payment_info_markdown: '',
  transfer_info_markdown: '',
  member_cap: 42,
  created_at: '2026-07-02T00:00:00.000Z',
}

const anEntry = (over: Partial<FaqEntry> & Pick<FaqEntry, 'id' | 'question'>): FaqEntry => ({
  event_id: 'e-1',
  answer: '',
  order: 0,
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const TWO: FaqEntry[] = [
  anEntry({ id: 'f-1', question: 'How do I get there?', answer: 'The **609** bus.', order: 0 }),
  anEntry({ id: 'f-2', question: 'What do I bring?', order: 1 }),
]

const stub = (over: Partial<FaqApi> = {}, entries: FaqEntry[] = TWO): FaqApi => ({
  getFaq: () => Promise.resolve({ entries }),
  getFaqSources: () => Promise.resolve({ sources: [] }),
  // The fallback when the bar has nothing (#321). `null` is "no burn planned at all",
  // which is the only state with nothing to show.
  getActiveEvent: () => Promise.resolve({ event: null }),
  addFaqEntry: () => Promise.reject(new Error('addFaqEntry is not stubbed here')),
  updateFaqEntry: () => Promise.reject(new Error('updateFaqEntry is not stubbed here')),
  deleteFaqEntry: () => Promise.reject(new Error('deleteFaqEntry is not stubbed here')),
  reorderFaq: () => Promise.reject(new Error('reorderFaq is not stubbed here')),
  copyFaq: () => Promise.reject(new Error('copyFaq is not stubbed here')),
  ...over,
})

const CHOSEN: MyBurn = { event: BURN, attendance: null }

// `null`, not `undefined`: passing `undefined` to a parameter with a default gets the
// default, so "no burn" written that way silently renders the usual one.
const renderPage = (api: FaqApi, viewer: Viewer = ADA, burn: MyBurn | null = CHOSEN) =>
  render(
    <ViewerProvider viewer={viewer}>
      <BurnProvider
        value={{ status: 'ready', burns: burn === null ? [] : [burn], selected: burn ?? undefined }}
      >
        <Faq api={api} />
      </BurnProvider>
    </ViewerProvider>,
  )

const asked = () => [...document.querySelectorAll('.faq-entry summary')].map((node) => node.textContent)

describe('the burn’s questions', () => {
  it('shows every question at once, in the order they are arranged', async () => {
    // The whole shape of the page: a column of headings somebody scans.
    renderPage(stub())

    await screen.findByText('How do I get there?')
    expect(asked()).toEqual(['How do I get there?', 'What do I bring?'])
  })

  it('keeps the answers folded away until one is opened', async () => {
    // `<details>` starts closed, and the answer is inside it — a page of expanded
    // answers is the wall of text this replaces.
    renderPage(stub())

    await screen.findByText('How do I get there?')
    const first = document.querySelector('.faq-entry')

    expect(first?.hasAttribute('open')).toBe(false)
  })

  it('renders an answer as markdown, not as raw html', async () => {
    // Members write these and members read them; `markdown.ts` escapes rather than
    // filters, so a script tag typed into an answer must come out as text.
    renderPage(stub({}, [anEntry({ id: 'f-1', question: 'Why?', answer: '**Hot**<script>bad()</script>' })]))

    await screen.findByText('Why?')
    expect(screen.getByText('Hot')).toBeTruthy()
    expect(document.querySelector('.faq-entry script')).toBeNull()
    expect(document.body.textContent).toContain('<script>bad()</script>')
  })

  it('says where an answer is still wanted', async () => {
    renderPage(stub())

    expect(await screen.findByText('Nobody has answered this yet.')).toBeTruthy()
  })

  it('offers to answer an unanswered one, and to edit an answered one', async () => {
    renderPage(stub())

    expect(await screen.findByRole('button', { name: 'Answer it' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('says so when nobody has asked anything', async () => {
    renderPage(stub({}, []))

    expect(await screen.findByText('Nobody has asked anything yet.')).toBeTruthy()
  })
})

describe('asking and answering', () => {
  it('adds a question with no answer, which is how one arrives', async () => {
    const addFaqEntry = vi.fn<FaqApi['addFaqEntry']>(() =>
      Promise.resolve({ entry: anEntry({ id: 'f-9', question: 'Is there a shower?' }) }),
    )
    renderPage(stub({ addFaqEntry }, []))

    fireEvent.input(await screen.findByLabelText('What do you want to know?'), {
      target: { value: '  Is there a shower?  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => {
      expect(addFaqEntry).toHaveBeenCalledWith('e-1', { question: 'Is there a shower?' })
    })
  })

  it('refuses a blank question without asking the server', async () => {
    const addFaqEntry = vi.fn<FaqApi['addFaqEntry']>(() =>
      Promise.resolve({ entry: anEntry({ id: 'f-9', question: 'x' }) }),
    )
    renderPage(stub({ addFaqEntry }, []))

    fireEvent.input(await screen.findByLabelText('What do you want to know?'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(addFaqEntry).not.toHaveBeenCalled()
  })

  it('saves an answer against the question somebody else asked', async () => {
    const updateFaqEntry = vi.fn<FaqApi['updateFaqEntry']>(() =>
      Promise.resolve({ entry: anEntry({ id: 'f-2', question: 'What do I bring?', answer: 'A torch.' }) }),
    )
    renderPage(stub({ updateFaqEntry }))

    fireEvent.click(await screen.findByRole('button', { name: 'Answer it' }))
    fireEvent.input(screen.getByLabelText('Answer to What do I bring?'), { target: { value: 'A torch.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateFaqEntry).toHaveBeenCalledWith('f-2', { question: 'What do I bring?', answer: 'A torch.' })
    })
  })

  it('removes one, on the second click', async () => {
    // Two clicks like a lead role and unlike a lane: one row holds a paragraph somebody
    // else wrote and nobody has a copy of (#323).
    const deleteFaqEntry = vi.fn<FaqApi['deleteFaqEntry']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteFaqEntry }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove What do I bring?' }))
    expect(deleteFaqEntry).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Really remove What do I bring?' }))

    await waitFor(() => expect(deleteFaqEntry).toHaveBeenCalledWith('f-2'))
  })

  it('keeps it when the confirm is dismissed', async () => {
    const deleteFaqEntry = vi.fn<FaqApi['deleteFaqEntry']>(() => Promise.resolve(undefined))
    renderPage(stub({ deleteFaqEntry }))

    fireEvent.click(await screen.findByRole('button', { name: 'Remove What do I bring?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(deleteFaqEntry).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Remove What do I bring?' })).toBeTruthy()
  })
})

describe('putting them in order', () => {
  it('moves one up from the keyboard, so a reorder needs no mouse', async () => {
    const reorderFaq = vi.fn<FaqApi['reorderFaq']>(() => Promise.resolve({ entries: TWO }))
    renderPage(stub({ reorderFaq }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move What do I bring?' }), {
      key: 'ArrowUp',
    })

    await waitFor(() => expect(reorderFaq).toHaveBeenCalledWith('e-1', ['f-2', 'f-1']))
  })

  it('leaves the first one where it is', async () => {
    // The passing sibling: `swap` answers undefined at the edge rather than wrapping
    // the list round, and nothing should be sent for a move that cannot happen.
    const reorderFaq = vi.fn<FaqApi['reorderFaq']>(() => Promise.resolve({ entries: TWO }))
    renderPage(stub({ reorderFaq }))

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move How do I get there?' }), {
      key: 'ArrowUp',
    })

    expect(reorderFaq).not.toHaveBeenCalled()
  })
})

describe('seeding from a previous burn', () => {
  it('offers it only while the list is empty', async () => {
    const sources = [{ event_id: 'e-0', name: 'Last summer', count: 4 }]
    renderPage(stub({ getFaqSources: () => Promise.resolve({ sources }) }, []))

    expect(await screen.findByRole('button', { name: /Copy/ })).toBeTruthy()
  })

  it('does not offer it once there are questions', async () => {
    const sources = [{ event_id: 'e-0', name: 'Last summer', count: 4 }]
    renderPage(stub({ getFaqSources: () => Promise.resolve({ sources }) }))

    await screen.findByText('How do I get there?')
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull()
  })
})

describe('with no burn selected', () => {
  it('reads the next burn instead, and says which it is', async () => {
    // The page most worth browsing before deciding to come, so it does not need a burn
    // you are in — an approved member who has joined none used to land on `NoBurn` and
    // could read nothing (#321).
    const getFaq = vi.fn<FaqApi['getFaq']>(() => Promise.resolve({ entries: TWO }))
    renderPage(stub({ getFaq, getActiveEvent: () => Promise.resolve({ event: BURN }) }), ADA, null)

    expect(await screen.findByText(/Showing Summer burn/)).toBeTruthy()
    expect(asked()).toEqual(['How do I get there?', 'What do I bring?'])
    expect(getFaq).toHaveBeenCalledWith('e-1', expect.anything())
  })

  it('offers the ask form against that burn', async () => {
    // Somebody deciding whether to come is exactly who has a question.
    const addFaqEntry = vi.fn<FaqApi['addFaqEntry']>(() =>
      Promise.resolve({ entry: anEntry({ id: 'f-9', question: 'Is there a shower?' }) }),
    )
    renderPage(stub({ addFaqEntry, getActiveEvent: () => Promise.resolve({ event: BURN }) }, []), ADA, null)

    fireEvent.input(await screen.findByLabelText('What do you want to know?'), {
      target: { value: 'Is there a shower?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() => {
      expect(addFaqEntry).toHaveBeenCalledWith('e-1', { question: 'Is there a shower?' })
    })
  })

  it('says nothing about a burn when none is planned', async () => {
    renderPage(stub(), ADA, null)

    expect(await screen.findByText(/no burn planned yet/)).toBeTruthy()
  })

  it('names no burn when the bar picked one', async () => {
    // The passing sibling: the note is for the fallback, and saying it over somebody's
    // own burn would read as though they were looking at the wrong one.
    const getActiveEvent = vi.fn<FaqApi['getActiveEvent']>(() => Promise.resolve({ event: BURN }))
    renderPage(stub({ getActiveEvent }))

    await screen.findByText('How do I get there?')
    expect(screen.queryByText(/Showing Summer burn/)).toBeNull()
    // And nothing was asked of it: the bar had the answer already.
    expect(getActiveEvent).not.toHaveBeenCalled()
  })

  it('waits for the burns before falling back', async () => {
    // The burns are fetched once for the session, so a page mounted before they arrive
    // would otherwise load the next burn and swap it for the reader's a moment later.
    const getActiveEvent = vi.fn<FaqApi['getActiveEvent']>(() => Promise.resolve({ event: BURN }))
    render(
      <ViewerProvider viewer={ADA}>
        <BurnProvider value={{ status: 'loading', burns: [], selected: undefined }}>
          <Faq api={stub({ getActiveEvent })} />
        </BurnProvider>
      </ViewerProvider>,
    )

    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(getActiveEvent).not.toHaveBeenCalled()
  })
})
