import type { FaqEntry, MyBurn, Thread } from '@sage-burner/shared'

import { faqPage, profilePage } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { FaqApi } from './Faq.tsx'

import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Faq } from './Faq.tsx'

afterEach(cleanup)
afterEach(() => history.replaceState(null, '', '/'))

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
  author_account_id: null,
  author_name: null,
  thread_id: null,
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
  getActiveEvent: () => Promise.resolve({ event: null }),
  addFaqEntry: () => Promise.reject(new Error('addFaqEntry is not stubbed here')),
  updateFaqEntry: () => Promise.reject(new Error('updateFaqEntry is not stubbed here')),
  deleteFaqEntry: () => Promise.reject(new Error('deleteFaqEntry is not stubbed here')),
  reorderFaq: () => Promise.reject(new Error('reorderFaq is not stubbed here')),
  copyFaq: () => Promise.reject(new Error('copyFaq is not stubbed here')),
  getEventAttendees: () => Promise.resolve({ attendees: [] }),
  getThread: () => Promise.reject(new Error('getThread is not stubbed here')),
  postComment: () => Promise.reject(new Error('postComment is not stubbed here')),
  updateComment: () => Promise.reject(new Error('updateComment is not stubbed here')),
  deleteComment: () => Promise.reject(new Error('deleteComment is not stubbed here')),
  supportComment: () => Promise.reject(new Error('supportComment is not stubbed here')),
  withdrawSupportForComment: () => Promise.reject(new Error('withdrawSupportForComment is not stubbed here')),
  uploadImage: () => Promise.reject(new Error('uploadImage is not stubbed here')),
  ...over,
})

const CHOSEN: MyBurn = { event: BURN, attendance: null }

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

const renderLinked = (api: FaqApi, url: string) => {
  history.replaceState(null, '', url)

  return render(
    <LocationProvider>
      <ViewerProvider viewer={ADA}>
        <BurnProvider value={{ status: 'ready', burns: [CHOSEN], selected: CHOSEN }}>
          <Faq api={api} />
        </BurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )
}

const TALKED: Thread = {
  id: 't-2',
  event_id: 'e-1',
  burn: 'Summer burn',
  entity_type: 'faq',
  entity_id: 'f-2',
  title: 'What do I bring?',
  link: null,
  body: null,
  gone: false,
  own: false,
  entry_count: 2,
  last_at: '2026-07-03T00:00:00.000Z',
  entries: [
    {
      id: 'te-1',
      kind: 'asked',
      author: { account_id: 'a-2', name: 'Bea' },
      body: 'asked this',
      created_at: '2026-07-02T00:00:00.000Z',
      edited_at: null,
      change: null,
      supporters: [],
      support_count: 0,
      supported_by_me: false,
    },
    {
      id: 'te-2',
      kind: 'comment',
      author: { account_id: 'a-3', name: 'Cid' },
      body: 'A head torch, if nothing else.',
      created_at: '2026-07-03T00:00:00.000Z',
      edited_at: null,
      change: null,
      supporters: [],
      support_count: 0,
      supported_by_me: false,
    },
  ],
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  followed_by_me: false,
}

const TALKED_ABOUT: FaqEntry[] = [
  anEntry({ id: 'f-1', question: 'How do I get there?', thread_id: 't-1', order: 0 }),
  anEntry({ id: 'f-2', question: 'What do I bring?', thread_id: 't-2', order: 1 }),
]

const asked = () => [...document.querySelectorAll('.faq-entry summary')].map((node) => node.textContent)

describe('the burn’s questions', () => {
  it('shows every question at once, in the order they are arranged', async () => {
    renderPage(stub())

    await screen.findByText('How do I get there?')
    expect(asked()).toEqual(['How do I get there?', 'What do I bring?'])
  })

  it('keeps the answers folded away until one is opened', async () => {
    renderPage(stub())

    await screen.findByText('How do I get there?')
    const first = document.querySelector('.faq-entry')

    expect(first?.hasAttribute('open')).toBe(false)
  })

  it('renders an answer as markdown, not as raw html', async () => {
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
    const getFaq = vi.fn<FaqApi['getFaq']>(() => Promise.resolve({ entries: TWO }))
    renderPage(stub({ getFaq, getActiveEvent: () => Promise.resolve({ event: BURN }) }), ADA, null)

    expect(await screen.findByText(/Showing Summer burn/)).toBeTruthy()
    expect(asked()).toEqual(['How do I get there?', 'What do I bring?'])
    expect(getFaq).toHaveBeenCalledWith('e-1', expect.anything())
  })

  it('offers the ask form against that burn', async () => {
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
    const getActiveEvent = vi.fn<FaqApi['getActiveEvent']>(() => Promise.resolve({ event: BURN }))
    renderPage(stub({ getActiveEvent }))

    await screen.findByText('How do I get there?')
    expect(screen.queryByText(/Showing Summer burn/)).toBeNull()
    expect(getActiveEvent).not.toHaveBeenCalled()
  })

  it('waits for the burns before falling back', async () => {
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

describe('who asked, and what has been said', () => {
  it('names who asked a question, linking to them', async () => {
    renderPage(
      stub({}, [
        anEntry({ id: 'f-1', question: 'How do I get there?', author_account_id: 'a-2', author_name: 'Bea' }),
      ]),
    )

    const who = await screen.findByRole('link', { name: 'Bea' })

    expect(who.closest('p')?.textContent).toBe('Asked by Bea')
    expect(who.getAttribute('href')).toBe(profilePage('a-2'))
  })

  it('says nothing of who asked when nobody is recorded as asking', async () => {
    renderPage(stub())

    await screen.findByText('How do I get there?')
    expect(screen.queryByText(/Asked by/)).toBeNull()
  })

  it('opens the conversation under a question and shows what was said', async () => {
    const getThread = vi.fn<FaqApi['getThread']>(() => Promise.resolve({ thread: TALKED }))
    renderPage(stub({ getThread }, TALKED_ABOUT))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Show what has been said about What do I bring?' }),
    )

    expect(await screen.findByText('A head torch, if nothing else.')).toBeTruthy()
    expect(getThread).toHaveBeenCalledWith('t-2', expect.anything())
    expect(getThread).not.toHaveBeenCalledWith('t-1', expect.anything())
    expect(
      screen.getByRole('button', { name: 'Hide what has been said about What do I bring?' }),
    ).toBeTruthy()
  })

  it('arrives with the question a link names open, and its conversation showing', async () => {
    const getThread = vi.fn<FaqApi['getThread']>(() => Promise.resolve({ thread: TALKED }))
    renderLinked(stub({ getThread }, TALKED_ABOUT), faqPage('e-1', 'f-2'))

    expect(await screen.findByText('A head torch, if nothing else.')).toBeTruthy()

    const [first, second] = document.querySelectorAll('.faq-entry')

    expect(first?.hasAttribute('open')).toBe(false)
    expect(second?.hasAttribute('open')).toBe(true)
  })
})
