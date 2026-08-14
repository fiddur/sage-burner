import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { useState } from 'preact/hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownField } from './MarkdownField.tsx'

// The resize is a canvas round-trip and happy-dom has no canvas that draws, so it is
// stubbed here and tested for what it can be tested for in `image.test.ts`. What is under
// test is everything after it: the placeholder, the swap, and what a refusal leaves behind.
vi.mock('../image.ts', () => ({ resizedImage: (file: Blob) => Promise.resolve(file) }))

afterEach(cleanup)

const aPicture = (name = 'sauna.jpg') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

/** The field is controlled, so the test has to hold the value the way a page would. */
const Field = ({
  upload,
  maxLength = 2000,
  start = '',
}: {
  upload?: (image: Blob) => Promise<{ id: string }>
  maxLength?: number
  start?: string
}) => {
  const [value, setValue] = useState(start)

  return (
    <MarkdownField
      label="Say something"
      value={value}
      maxLength={maxLength}
      upload={upload}
      onInput={setValue}
    />
  )
}

const paste = (files: File[]) => {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files } })
  fireEvent(screen.getByLabelText('Say something'), event)
}

const drop = (files: File[]) =>
  fireEvent.drop(screen.getByLabelText('Say something'), { dataTransfer: { files, types: ['Files'] } })

const box = () => screen.getByLabelText<HTMLTextAreaElement>('Say something')

describe('putting a picture in a markdown field', () => {
  it('writes the markdown for what was pasted', async () => {
    render(<Field upload={() => Promise.resolve({ id: 'img-1' })} />)

    paste([aPicture()])

    await waitFor(() => expect(box().value).toBe('![](/api/images/img-1)'))
  })

  it('takes one dropped on the box too', async () => {
    render(<Field upload={() => Promise.resolve({ id: 'img-2' })} />)

    drop([aPicture()])

    await waitFor(() => expect(box().value).toBe('![](/api/images/img-2)'))
  })

  it('takes one chosen from a phone, at the end of what is there', async () => {
    render(<Field upload={() => Promise.resolve({ id: 'img-3' })} start="already said" />)

    fireEvent.change(screen.getByLabelText('Add a picture to Say something'), {
      target: { files: [aPicture()] },
    })

    await waitFor(() => expect(box().value).toBe('already said![](/api/images/img-3)'))
  })

  it('says why an SVG will not do, rather than failing at the decode', async () => {
    // The server refuses the type outright. Left to `resizedImage` it fails at
    // `createImageBitmap` and reads as "could not read that picture", which sends
    // somebody with a perfectly good logo off to re-export it (#392).
    const upload = vi.fn(() => Promise.resolve({ id: 'img-1' }))
    render(<Field upload={upload} />)

    paste([new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })])

    expect((await screen.findByRole('alert')).textContent).toContain('An SVG cannot be used')
    expect(upload).not.toHaveBeenCalled()
    expect(box().value).toBe('')
  })

  it('still takes the raster pictures pasted alongside one', async () => {
    // The passing sibling: refusing the whole paste would satisfy the test above while
    // losing the photograph somebody meant to send.
    render(<Field upload={() => Promise.resolve({ id: 'img-1' })} />)

    paste([new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), aPicture()])

    await waitFor(() => expect(box().value).toBe('![](/api/images/img-1)'))
  })

  it('sits in the toolbar, beside the buttons that write syntax', () => {
    render(<Field upload={() => Promise.resolve({ id: 'img-1' })} />)

    const control = screen.getByLabelText('Add a picture to Say something')

    expect(control.closest('.syntax-row')).not.toBeNull()
  })

  it('leaves what it has to report below the box', async () => {
    render(<Field upload={() => Promise.reject(new Error('nope'))} />)

    paste([aPicture()])

    expect((await screen.findByRole('alert')).closest('.syntax-row')).toBeNull()
  })

  it('says a picture is on its way while the bytes are going up', async () => {
    let finish = (_: { id: string }) => undefined as void
    render(<Field upload={() => new Promise<{ id: string }>((resolve) => (finish = resolve))} />)

    paste([aPicture()])

    expect(await screen.findByText(/Sending a picture/)).toBeTruthy()

    finish({ id: 'img-8' })
    await waitFor(() => expect(screen.queryByText(/Sending a picture/)).toBeNull())
  })

  it('stands something in the text while the bytes are going up', async () => {
    let finish = (_: { id: string }) => undefined as void
    render(<Field upload={() => new Promise<{ id: string }>((resolve) => (finish = resolve))} />)

    paste([aPicture()])

    await waitFor(() => expect(box().value).toBe('![Uploading sauna.jpg…]()'))

    finish({ id: 'img-4' })
    await waitFor(() => expect(box().value).toBe('![](/api/images/img-4)'))
  })

  it('keeps what was typed while the picture was in flight', async () => {
    // #205's rule, and this is the field every comment box shares: a picture arriving
    // must not throw away the sentence somebody wrote while waiting for it.
    let finish = (_: { id: string }) => undefined as void
    render(<Field upload={() => new Promise<{ id: string }>((resolve) => (finish = resolve))} />)

    paste([aPicture()])
    await waitFor(() => expect(box().value).toBe('![Uploading sauna.jpg…]()'))

    fireEvent.input(box(), { target: { value: '![Uploading sauna.jpg…]() and here it is' } })
    finish({ id: 'img-5' })

    await waitFor(() => expect(box().value).toBe('![](/api/images/img-5) and here it is'))
  })

  it('takes the placeholder back out when the upload is refused, and says why', async () => {
    render(<Field upload={() => Promise.reject(new Error('nope'))} start="what I said" />)

    paste([aPicture()])

    await waitFor(() => expect(screen.getByText(/Could not read that picture/)).toBeTruthy())
    expect(box().value).toBe('what I said')
  })

  it('gives two pictures at once two placeholders, in the order they were dropped', async () => {
    const ids = ['img-a', 'img-b']
    render(<Field upload={() => Promise.resolve({ id: ids.shift() ?? 'none' })} />)

    drop([aPicture('one.jpg'), aPicture('two.jpg')])

    await waitFor(() => expect(box().value).toBe('![](/api/images/img-a)![](/api/images/img-b)'))
  })

  it('refuses when there is no room left in the field', async () => {
    render(<Field upload={() => Promise.resolve({ id: 'img-6' })} maxLength={10} start="0123456789" />)

    paste([aPicture()])

    await waitFor(() => expect(screen.getByText(/not room for a picture/)).toBeTruthy())
    expect(box().value).toBe('0123456789')
  })

  it('counts the room the finished markdown needs, not the shorter placeholder', async () => {
    // `![Uploading a.jpg…]()` is 21 characters and `![](/api/images/<uuid>)` is 53, so a
    // field with room for the first and not the second used to take the picture and
    // overflow on the swap — and `maxLength` does not truncate a value set from code, so
    // nothing caught it until the save came back refused.
    render(<Field upload={() => Promise.resolve({ id: 'x'.repeat(36) })} maxLength={60} start="0123456789" />)

    paste([aPicture('a.jpg')])

    await waitFor(() => expect(screen.getByText(/not room for a picture/)).toBeTruthy())
    expect(box().value).toBe('0123456789')
  })

  it('still takes one when the finished markdown does fit', async () => {
    // The passing sibling: a guard that refused everything would satisfy the test above
    // while making a picture impossible to add to any bounded field.
    render(<Field upload={() => Promise.resolve({ id: 'x'.repeat(36) })} maxLength={64} start="0123456789" />)

    paste([aPicture('a.jpg')])

    await waitFor(() => expect(box().value).toBe(`0123456789![](/api/images/${'x'.repeat(36)})`))
  })

  it('lets an ordinary paste of text alone', () => {
    render(<Field upload={() => Promise.resolve({ id: 'img-7' })} />)

    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [] } })
    fireEvent(box(), event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('offers nothing where the field is one the public reads', () => {
    // `/api/images/:id` is `requireApproved`, so a picture in the welcome text would be
    // broken for exactly the people that text is written for. `docs/the-app.md` has why
    // that is the trade rather than the bug.
    render(<Field />)

    expect(screen.queryByLabelText('Add a picture to Say something')).toBeNull()
  })

  it('ignores a picture pasted into a field that does not take them', () => {
    render(<Field />)

    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [aPicture()] } })
    fireEvent(box(), event)

    expect(event.defaultPrevented).toBe(false)
    expect(box().value).toBe('')
  })
})
