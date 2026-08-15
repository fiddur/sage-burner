import { cleanup, render } from '@testing-library/preact'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { Icon, ICONS } from './Icon.tsx'

afterEach(cleanup)

const drawn = (container: Element) => container.querySelector('svg')

const SOURCE_ROOT = path.join(import.meta.dirname, '..')

const sourcesUnder = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return await sourcesUnder(full)
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) return []
      if (entry.name.includes('.test.') || entry.name.startsWith('Icon.')) return []

      return [full]
    }),
  )

  return found.flat()
}

const namesDrawnIn = (source: string): Set<string> => {
  const drawnHere = new Set<string>()
  const add = (name: string | undefined) => {
    if (name !== undefined) drawnHere.add(name)
  }

  for (const tag of source.match(/<Icon\b[^>]*>/gsu) ?? []) {
    for (const named of tag.matchAll(/\bname\s*=\s*\{?[^'"{}]*['"]([a-z][a-z-]*)['"]/gu)) add(named[1])
    for (const ternary of tag.matchAll(/\bname\s*=\s*\{([^}]*)\}/gu)) {
      for (const quoted of (ternary[1] ?? '').matchAll(/['"]([a-z][a-z-]*)['"]/gu)) add(quoted[1])
    }
  }
  for (const named of source.matchAll(/\b(?:busyIcon|icon)\s*[=:]\s*['"]([a-z][a-z-]*)['"]/gu)) {
    add(named[1])
  }

  return drawnHere
}

describe('an icon', () => {
  it('draws the shapes of the name it is given', () => {
    const { container } = render(<Icon name="edit" />)

    expect(drawn(container)?.getAttribute('data-icon')).toBe('edit')
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('is hidden from anything reading the page aloud', () => {
    const { container } = render(<Icon name="comment" />)

    expect(drawn(container)?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes its colour from whatever it sits in', () => {
    const { container } = render(<Icon name="link" />)

    expect(drawn(container)?.getAttribute('stroke')).toBe('currentColor')
  })

  it('keeps its own class when given another', () => {
    const { container } = render(<Icon name="link" class="is-away" />)

    expect(drawn(container)?.getAttribute('class')).toBe('icon is-away')
  })
})

describe('the set', () => {
  it('ships nothing the app does not draw', async () => {
    const sources = await sourcesUnder(SOURCE_ROOT)
    const drawnAnywhere = new Set(
      (
        await Promise.all(sources.map(async (file) => [...namesDrawnIn(await readFile(file, 'utf8'))]))
      ).flat(),
    )

    expect(Object.keys(ICONS).filter((name) => !drawnAnywhere.has(name))).toEqual([])
  })

  it('finds the names where they are written, so the sweep above can fail', async () => {
    const toolbar = await readFile(path.join(SOURCE_ROOT, 'components', 'SyntaxToolbar.tsx'), 'utf8')
    const thread = await readFile(path.join(SOURCE_ROOT, 'components', 'DreamThread.tsx'), 'utf8')

    expect([...namesDrawnIn(toolbar)]).toContain('bullets')
    expect([...namesDrawnIn(thread)]).toContain('edit')
    expect([...namesDrawnIn('<Icon name="edit" />')]).toEqual(['edit'])
    expect([...namesDrawnIn('nothing here')]).toEqual([])
    expect([...namesDrawnIn('<Icon name="link" class="close" />')]).toEqual(['link'])
  })
})
