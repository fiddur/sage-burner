import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { useRef } from 'preact/hooks'
import { afterEach, describe, expect, it } from 'vitest'

import { useOverlay } from './overlay.ts'

afterEach(cleanup)

const Overlay = ({ empty = false }: { empty?: boolean }) => {
  const panel = useRef<HTMLDivElement>(null)
  useOverlay(panel)

  return (
    <div>
      <button type="button">behind</button>
      <div ref={panel} tabIndex={-1} data-testid="panel">
        {!empty && (
          <>
            <button type="button">first</button>
            <button type="button">last</button>
          </>
        )}
      </div>
    </div>
  )
}

const Page = ({ open }: { open: boolean }) => <div>{open && <Overlay />}</div>

describe('an overlay while it is up', () => {
  it('holds the page behind it still, and lets it go again', () => {
    const { rerender } = render(<Page open={true} />)

    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Page open={false} />)

    expect(document.body.style.overflow).toBe('')
  })

  it('puts back whatever the page was already doing rather than clearing it', () => {
    document.body.style.overflow = 'clip'
    const { rerender } = render(<Page open={true} />)

    rerender(<Page open={false} />)

    expect(document.body.style.overflow).toBe('clip')
    document.body.style.overflow = ''
  })

  it('sends Tab from the last control back to the first, and takes the key over to do it', () => {
    render(<Page open={true} />)
    screen.getByRole('button', { name: 'last' }).focus()

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
    expect(tab.defaultPrevented).toBe(true)
  })

  it('sends Shift+Tab from the first control to the last', () => {
    render(<Page open={true} />)
    screen.getByRole('button', { name: 'first' }).focus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })

  it('sends Shift+Tab from the panel itself to the last, since the panel is not in the order', () => {
    render(<Page open={true} />)
    screen.getByTestId('panel').focus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })

  it('takes focus back when it has escaped to the page behind', () => {
    render(<Page open={true} />)
    screen.getByRole('button', { name: 'behind' }).focus()

    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('leaves a key that is not Tab alone', () => {
    render(<Page open={true} />)
    const behind = screen.getByRole('button', { name: 'behind' })
    behind.focus()

    fireEvent.keyDown(document, { key: 'a' })

    expect(document.activeElement).toBe(behind)
  })

  it('leaves Tab to the browser when there is nothing to focus', () => {
    render(<Overlay empty={true} />)
    screen.getByRole('button', { name: 'behind' }).focus()

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(false)
  })
})
