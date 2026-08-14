import { cleanup, render } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { Icon } from './Icon.tsx'

afterEach(cleanup)

const drawn = (container: Element) => container.querySelector('svg')

describe('an icon', () => {
  it('draws the shapes of the name it is given', () => {
    const { container } = render(<Icon name="edit" />)

    expect(drawn(container)?.getAttribute('data-icon')).toBe('edit')
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('is hidden from anything reading the page aloud', () => {
    const { container } = render(<Icon name="bell" />)

    expect(drawn(container)?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes its colour from whatever it sits in', () => {
    const { container } = render(<Icon name="heart" />)

    expect(drawn(container)?.getAttribute('stroke')).toBe('currentColor')
  })

  it('keeps its own class when given another', () => {
    const { container } = render(<Icon name="heart" class="is-given" />)

    expect(drawn(container)?.getAttribute('class')).toBe('icon is-given')
  })
})
