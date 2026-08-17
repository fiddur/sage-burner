import type { Thread, ThreadEntry } from '@sage-burner/shared'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DreamThread } from './DreamThread.tsx'

afterEach(cleanup)

const anEntry = (over: Partial<ThreadEntry> & Pick<ThreadEntry, 'id' | 'body'>): ThreadEntry => ({
  kind: 'comment',
  author: { account_id: 'a-1', name: 'Ada' },
  created_at: '2026-08-07T18:00:00.000Z',
  edited_at: null,
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  ...over,
})

const aThread = (entries: ThreadEntry[]): Thread => ({
  id: 'th-1',
  event_id: 'e-1',
  burn: 'Summer burn',
  entity_type: 'session',
  entity_id: 's-1',
  title: 'Sauna at dawn',
  link: '/dreams?burn=e-1&dream=s-1',
  body: null,
  own: false,
  gone: false,
  entry_count: entries.length,
  supporters: [],
  support_count: 0,
  supported_by_me: false,
  followed_by_me: false,
  last_at: '2026-08-07T18:00:00.000Z',
  entries,
})

const show = (
  thread: Thread | undefined,
  over: Partial<Parameters<typeof DreamThread>[0]> = {},
): {
  say: ReturnType<typeof vi.fn>
  rewrite: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  heart: ReturnType<typeof vi.fn>
} => {
  const say = vi.fn()
  const rewrite = vi.fn()
  const remove = vi.fn()
  const heart = vi.fn()

  render(
    <DreamThread
      thread={thread}
      viewerId="a-1"
      admin={false}
      busy={false}
      more={false}
      upload={() => Promise.reject(new Error('uploadImage is not stubbed here'))}
      onSay={say}
      onRewrite={rewrite}
      onRemove={remove}
      onHeart={heart}
      {...over}
    />,
  )

  return { say, rewrite, remove, heart }
}

describe('a conversation about a dream', () => {
  it('draws nothing at all while there is no thread to draw', () => {
    show(undefined)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says who wrote what, and renders it as markdown', () => {
    show(aThread([anEntry({ id: 't-1', body: '**bring** a towel' })]))

    expect(screen.getByText('Ada')).toBeTruthy()
    expect(document.querySelector('.markdown-preview strong')?.textContent).toBe('bring')
  })

  it('draws a line the app wrote as one quiet sentence', () => {
    show(aThread([anEntry({ id: 't-1', kind: 'offered', body: 'offered this dream' })]))

    expect(document.querySelector('.thread-did')?.textContent).toContain('Ada offered this dream')
    expect(screen.queryByRole('button', { name: /Rewrite/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Take back this comment/ })).toBeNull()
  })

  it('reads as "Somebody" where the account behind a line has gone', () => {
    show(aThread([anEntry({ id: 't-1', kind: 'offered', body: 'offered this dream', author: null })]))

    expect(document.querySelector('.thread-did')?.textContent).toContain('Somebody offered this dream')
  })

  it('offers the pen and the bin on your own words, and neither on somebody else’s', () => {
    show(
      aThread([
        anEntry({ id: 't-1', body: 'mine' }),
        anEntry({ id: 't-2', body: 'theirs', author: { account_id: 'a-2', name: 'Bea' } }),
      ]),
    )

    expect(screen.getAllByRole('button', { name: /Rewrite what you said/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Take back this comment/ })).toHaveLength(1)
  })

  it('lets an admin take somebody else’s comment down without rewriting it', () => {
    show(aThread([anEntry({ id: 't-2', body: 'theirs', author: { account_id: 'a-2', name: 'Bea' } })]), {
      admin: true,
    })

    expect(screen.getAllByRole('button', { name: /Take back this comment/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Rewrite what you said/ })).toBeNull()
  })

  it('sends what was typed, and clears the box once the caller says it landed', async () => {
    const { say } = show(aThread([]))

    const box = screen.getByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: '  is one mat enough?  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))

    expect(say).toHaveBeenCalledWith('is one mat enough?', expect.any(Function))
    expect((box as HTMLTextAreaElement).value).toBe('  is one mat enough?  ')

    await act(() => say.mock.calls[0]?.[1]?.())

    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps what was typed where the reply never landed', () => {
    const { say } = show(aThread([]))

    const box = screen.getByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: 'is one mat enough?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))

    expect(say).toHaveBeenCalled()
    expect((box as HTMLTextAreaElement).value).toBe('is one mat enough?')
  })

  it('is the app’s one editor, so a comment can be previewed like everything else', () => {
    show(aThread([]))

    const box = screen.getByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: '- a towel\n- a mug' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['a towel', 'a mug'])
  })

  it('says where to read about the marks it takes', () => {
    show(aThread([]))

    expect(screen.getByRole('link', { name: 'Markdown is supported' }).getAttribute('href')).toBe(
      '/formatting',
    )
  })

  it('will not send an empty comment', () => {
    const { say } = show(aThread([]))

    const box = screen.getByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: '   ' } })

    expect(screen.getByRole('button', { name: 'Say it' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    expect(say).not.toHaveBeenCalled()
  })

  it('will not send a comment with a picture still on the way', () => {
    const { say } = show(aThread([]))

    const box = screen.getByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: 'look at this ![Uploading sauna.jpg…]()' } })

    expect(screen.getByRole('button', { name: 'Say it' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    expect(say).not.toHaveBeenCalled()
  })

  it('sends it once the picture has landed', () => {
    const { say } = show(aThread([]))

    const box = screen.getByLabelText('Say something about Sauna at dawn')
    fireEvent.input(box, { target: { value: 'look at this ![](/api/images/img-1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))

    expect(say).toHaveBeenCalledWith('look at this ![](/api/images/img-1)', expect.any(Function))
  })

  it('will not save a rewrite with a picture still on the way', () => {
    const { rewrite } = show(aThread([anEntry({ id: 't-1', body: 'bring a towel' })]))

    fireEvent.click(screen.getByRole('button', { name: /Rewrite what you said/ }))
    fireEvent.input(screen.getByLabelText('Rewrite what you said'), {
      target: { value: 'bring a towel ![Uploading sauna.jpg…]()' },
    })

    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(rewrite).not.toHaveBeenCalled()
  })

  it('rewrites what you said, starting from what you said', () => {
    const { rewrite } = show(aThread([anEntry({ id: 't-1', body: 'bring a towl' })]))

    fireEvent.click(screen.getByRole('button', { name: /Rewrite what you said/ }))

    const box = screen.getByLabelText('Rewrite what you said')
    expect((box as HTMLTextAreaElement).value).toBe('bring a towl')

    fireEvent.input(box, { target: { value: 'bring a towel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(rewrite).toHaveBeenCalledWith('t-1', 'bring a towel', expect.any(Function))
  })

  it('keeps the rewrite box open, and what is in it, where the save never landed', () => {
    show(aThread([anEntry({ id: 't-1', body: 'bring a towl' })]))

    fireEvent.click(screen.getByRole('button', { name: /Rewrite what you said/ }))
    fireEvent.input(screen.getByLabelText('Rewrite what you said'), {
      target: { value: 'bring a towel' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByLabelText<HTMLTextAreaElement>('Rewrite what you said').value).toBe('bring a towel')
  })

  it('shuts the rewrite box once the save lands', () => {
    show(aThread([anEntry({ id: 't-1', body: 'bring a towl' })]), {
      onRewrite: (_id, _body, done) => done(),
    })

    fireEvent.click(screen.getByRole('button', { name: /Rewrite what you said/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('textbox', { name: 'Rewrite what you said' })).toBeNull()
  })

  it('says a comment was rewritten, so nobody reads an edit as the original', () => {
    show(aThread([anEntry({ id: 't-1', body: 'bring a towel', edited_at: '2026-08-08T09:00:00.000Z' })]))

    expect(document.querySelector('.thread-who')?.textContent).toContain('edited')
  })

  it('offers the rest of a conversation only where there is somewhere to ask for it', () => {
    const showAll = vi.fn()
    show(aThread([anEntry({ id: 't-1', body: 'a word' })]), { more: true, onShowAll: showAll })

    fireEvent.click(screen.getByRole('button', { name: /Show the whole thread/ }))
    expect(showAll).toHaveBeenCalled()
  })
})

describe('the heart on a comment', () => {
  it('gives one, naming the comment by whoever said it', () => {
    const { heart } = show(aThread([anEntry({ id: 't-1', body: 'bring a towel' })]))

    fireEvent.click(screen.getByRole('button', { name: 'Give a heart to what Ada said' }))

    expect(heart).toHaveBeenCalledWith('t-1', true)
  })

  it('takes one back', () => {
    const { heart } = show(
      aThread([
        anEntry({
          id: 't-1',
          body: 'bring a towel',
          support_count: 1,
          supported_by_me: true,
          supporters: [{ account_id: 'a-1', name: 'Ada', avatar: null }],
        }),
      ]),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Take back your heart for what Ada said' }))

    expect(heart).toHaveBeenCalledWith('t-1', false)
  })

  it('unfolds whoever gave one under the comment itself', () => {
    show(
      aThread([
        anEntry({
          id: 't-1',
          body: 'bring a towel',
          support_count: 2,
          supporters: [
            { account_id: 'a-1', name: 'Ada', avatar: null },
            { account_id: 'a-2', name: 'Bea', avatar: null },
          ],
        }),
      ]),
    )

    fireEvent.click(screen.getByRole('button', { name: '2 gave a heart to what Ada said' }))

    expect(screen.getByRole('link', { name: 'Bea' }).getAttribute('href')).toBe('/members/a-2')
  })

  it('offers none on a line the app wrote, a done thing being nobody’s to love', () => {
    show(aThread([anEntry({ id: 't-1', body: 'offered this dream', kind: 'offered' })]))

    expect(screen.queryByRole('button', { name: /heart/ })).toBeNull()
  })
})

describe('naming somebody under a dream', () => {
  const PEOPLE = [{ account_id: 'a-2', name: 'Bea' }]

  const nameIn = (label: string, value: string, caret: number) => {
    const box = screen.getByLabelText(label)
    fireEvent.input(box, { target: { value } })
    fireEvent.keyUp(box, { target: { selectionStart: caret } })
  }

  it('offers whoever is coming while something is being said', () => {
    show(aThread([]), { people: PEOPLE })

    nameIn('Say something about Sauna at dawn', 'ask @Be', 7)

    expect(screen.getByRole('button', { name: '@Bea' })).toBeTruthy()
  })

  it('offers them while something already said is being fixed up', () => {
    show(aThread([anEntry({ id: 't-1', body: 'mine' })]), { people: PEOPLE })

    fireEvent.click(screen.getByRole('button', { name: /Rewrite what you said/ }))
    nameIn('Rewrite what you said', 'mine, ask @Be', 13)

    expect(screen.getByRole('button', { name: '@Bea' })).toBeTruthy()
  })

  it('offers nobody where the caller passed none', () => {
    show(aThread([]))

    nameIn('Say something about Sauna at dawn', '@', 1)

    expect(screen.queryByRole('button', { name: '@everybody' })).toBeNull()
  })
})
