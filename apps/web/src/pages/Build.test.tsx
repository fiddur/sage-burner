import type { BuildItem, BuildProject, MyBurn, Thread } from '@sage-burner/shared'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import { LocationProvider } from 'preact-iso'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Viewer } from '../viewer.tsx'
import type { BuildApi } from './Build.tsx'

import { BurnProvider } from '../burn.tsx'
import { ViewerProvider } from '../viewer.tsx'
import { Build } from './Build.tsx'

afterEach(cleanup)

const ADA: Viewer = {
  status: 'signed-in',
  account: { id: 'a-1', name: 'Ada', avatar: null, roles: ['member'] },
}

const BURN: MyBurn = {
  event: {
    id: 'e-1',
    name: 'Summer burn',
    slug: 'summer-burn',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    start_time: '16:00',
    end_time: '12:00',
  },
  attendance: null,
}

const COMING = [
  { account_id: 'a-1', name: 'Ada', avatar: null },
  { account_id: 'a-2', name: 'Bea', avatar: null },
]

const anItem = (over: Partial<BuildItem> & Pick<BuildItem, 'id' | 'text'>): BuildItem => ({
  project_id: 'p-1',
  priority: 'needed',
  done: null,
  created_at: '2026-07-02T00:00:00.000Z',
  ...over,
})

const aProject = (over: Partial<BuildProject> & Pick<BuildProject, 'id'>): BuildProject => ({
  event_id: 'e-1',
  author_account_id: 'a-1',
  author_name: 'Ada',
  title: 'Dome',
  description: '',
  tier: 'reality',
  order: 0,
  withdrawn_at: null,
  created_at: '2026-07-02T00:00:00.000Z',
  lead: null,
  helpers: [],
  items: [],
  thread_id: 't-1',
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  ...over,
})

const aThread = (): Thread => ({
  id: 't-1',
  event_id: 'e-1',
  burn: 'Summer burn',
  entity_type: 'build',
  entity_id: 'p-1',
  title: 'Dome',
  link: null,
  body: null,
  gone: false,
  own: true,
  entry_count: 0,
  last_at: null,
  entries: [],
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  followed_by_me: false,
})

const refused = (name: string) => () => Promise.reject(new Error(`${name} is not stubbed here`))

const stub = (over: Partial<BuildApi> = {}, projects: BuildProject[] = []): BuildApi => ({
  getBuildProjects: () => Promise.resolve({ projects }),
  getEventAttendees: () => Promise.resolve({ attendees: COMING }),
  addBuildProject: refused('addBuildProject'),
  updateBuildProject: refused('updateBuildProject'),
  reorderBuildProjects: refused('reorderBuildProjects'),
  deleteBuildProject: refused('deleteBuildProject'),
  restoreBuildProject: refused('restoreBuildProject'),
  setBuildLead: refused('setBuildLead'),
  addBuildHelper: refused('addBuildHelper'),
  removeBuildHelper: refused('removeBuildHelper'),
  addBuildItem: refused('addBuildItem'),
  updateBuildItem: refused('updateBuildItem'),
  deleteBuildItem: refused('deleteBuildItem'),
  supportThread: refused('supportThread'),
  withdrawSupportForThread: refused('withdrawSupportForThread'),
  getThread: refused('getThread'),
  postComment: refused('postComment'),
  updateComment: refused('updateComment'),
  deleteComment: refused('deleteComment'),
  supportComment: refused('supportComment'),
  withdrawSupportForComment: refused('withdrawSupportForComment'),
  uploadImage: refused('uploadImage'),
  ...over,
})

const renderPage = (api: BuildApi, at = '/build?burn=e-1') => {
  history.replaceState(null, '', at)

  return render(
    <LocationProvider>
      <ViewerProvider viewer={ADA}>
        <BurnProvider value={{ status: 'ready', burns: [BURN], selected: BURN }}>
          <Build api={api} />
        </BurnProvider>
      </ViewerProvider>
    </LocationProvider>,
  )
}

const sectionFor = (heading: string): HTMLElement => {
  const found = screen.getByRole('heading', { level: 2, name: heading }).closest('section')
  if (found === null) throw new Error(`no section under ${heading}`)

  return found
}

describe('the build page', () => {
  it('shows Realities ahead of Nice to have, each with its own projects', async () => {
    renderPage(
      stub({}, [
        aProject({ id: 'p-2', title: 'Swing', tier: 'nice_to_have' }),
        aProject({ id: 'p-1', title: 'Dome', tier: 'reality' }),
      ]),
    )

    await screen.findByRole('heading', { level: 3, name: 'Dome' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((one) => one.textContent)
    expect(headings.slice(0, 2)).toEqual(['Realities', 'Nice to have'])
    expect(within(sectionFor('Realities')).queryByText('Swing')).toBeNull()
    expect(within(sectionFor('Nice to have')).getByRole('heading', { name: 'Swing' })).toBeTruthy()
  })

  it('keeps a project that was taken off out of its header, offering it back instead', async () => {
    const restoreBuildProject = vi.fn<BuildApi['restoreBuildProject']>(() =>
      Promise.resolve({ project: aProject({ id: 'p-1' }) }),
    )
    renderPage(
      stub({ restoreBuildProject }, [
        aProject({ id: 'p-1', title: 'Dome', withdrawn_at: new Date().toISOString() }),
      ]),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Bring Dome back' }))

    expect(within(sectionFor('Realities')).queryByText('Dome')).toBeNull()
    await waitFor(() => expect(restoreBuildProject).toHaveBeenCalledWith('p-1'))
  })

  it('lists the checklist as the server sent it, a ticked thing greyed where it stands', async () => {
    renderPage(
      stub({}, [
        aProject({
          id: 'p-1',
          items: [
            anItem({
              id: 'i-1',
              text: 'Struts',
              done: { account_id: 'a-2', name: 'Bea', at: '2026-07-03T00:00:00.000Z' },
            }),
            anItem({ id: 'i-2', text: 'Bolts' }),
            anItem({ id: 'i-3', text: 'Fairy lights', priority: 'bonus' }),
          ],
        }),
      ]),
    )

    const struts = await screen.findByRole('checkbox', { name: 'Struts' })
    expect(screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual([
      'Struts',
      'Bolts',
      'Fairy lights',
    ])
    expect(struts).toHaveProperty('checked', true)
    expect(struts.closest('li')?.classList.contains('is-done')).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Bolts' }).closest('li')?.classList.contains('is-done')).toBe(
      false,
    )
  })

  it('ticks a thing off through the checkbox', async () => {
    const updateBuildItem = vi.fn<BuildApi['updateBuildItem']>(() =>
      Promise.resolve({ project: aProject({ id: 'p-1' }) }),
    )
    renderPage(
      stub({ updateBuildItem }, [aProject({ id: 'p-1', items: [anItem({ id: 'i-1', text: 'Struts' })] })]),
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Struts' }))

    await waitFor(() => expect(updateBuildItem).toHaveBeenCalledWith('i-1', { done: true }))
  })

  it('adds a project under the header chosen', async () => {
    const addBuildProject = vi.fn<BuildApi['addBuildProject']>(() =>
      Promise.resolve({ project: aProject({ id: 'p-9' }) }),
    )
    renderPage(stub({ addBuildProject }))

    fireEvent.input(await screen.findByRole('textbox', { name: 'What is being built?' }), {
      target: { value: ' Swing ' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Under' }), { target: { value: 'nice_to_have' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))

    await waitFor(() =>
      expect(addBuildProject).toHaveBeenCalledWith('e-1', { title: 'Swing', tier: 'nice_to_have' }),
    )
  })

  it('adds a thing to a checklist, needed unless said otherwise', async () => {
    const addBuildItem = vi.fn<BuildApi['addBuildItem']>(() =>
      Promise.resolve({ project: aProject({ id: 'p-1' }) }),
    )
    renderPage(stub({ addBuildItem }, [aProject({ id: 'p-1' })]))

    fireEvent.input(await screen.findByRole('textbox', { name: 'Something Dome needs' }), {
      target: { value: 'Struts' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(addBuildItem).toHaveBeenCalledWith('p-1', { text: 'Struts', priority: 'needed' }),
    )
  })

  it('keeps a checklist line that failed to save in its box, and empties the box once one saves', async () => {
    const addBuildItem = vi
      .fn<BuildApi['addBuildItem']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ project: aProject({ id: 'p-1' }) })
    renderPage(stub({ addBuildItem }, [aProject({ id: 'p-1' })]))

    const box = await screen.findByRole('textbox', { name: 'Something Dome needs' })
    fireEvent.input(box, { target: { value: 'Struts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await screen.findByText('Could not add that.')
    expect(box).toHaveProperty('value', 'Struts')

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(box).toHaveProperty('value', ''))
    expect(addBuildItem).toHaveBeenCalledTimes(2)
  })

  it('offers to take the lead when nobody has it', async () => {
    const setBuildLead = vi.fn<BuildApi['setBuildLead']>(() =>
      Promise.resolve({ project: aProject({ id: 'p-1' }) }),
    )
    renderPage(stub({ setBuildLead }, [aProject({ id: 'p-1' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Take the spot on Dome lead' }))

    await waitFor(() => expect(setBuildLead).toHaveBeenCalledWith('p-1', 'a-1'))
  })

  it('opens the conversation the link points at, without a click', async () => {
    const getThread = vi.fn<BuildApi['getThread']>(() => Promise.resolve({ thread: aThread() }))
    renderPage(stub({ getThread }, [aProject({ id: 'p-1' })]), '/build?burn=e-1&project=p-1')

    await waitFor(() => expect(getThread).toHaveBeenCalledWith('t-1', expect.anything()))
    expect(await screen.findByRole('button', { name: 'Hide what has been said about Dome' })).toBeTruthy()
  })

  it('hearts the project’s card', async () => {
    const supportThread = vi.fn<BuildApi['supportThread']>(() => Promise.resolve({ thread: aThread() }))
    renderPage(stub({ supportThread }, [aProject({ id: 'p-1' })]))

    fireEvent.click(await screen.findByRole('button', { name: 'Give a heart to Dome' }))

    await waitFor(() => expect(supportThread).toHaveBeenCalledWith('t-1'))
  })
})
