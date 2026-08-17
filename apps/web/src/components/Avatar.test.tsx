import { cleanup, render, screen } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'

import { squareCrop } from '../avatar.ts'
import { Avatar } from './Avatar.tsx'

afterEach(cleanup)

describe('the circle', () => {
  it('draws initials when there is no picture, and asks for nothing', () => {
    render(<Avatar accountId="a-1" name="Ada Lovelace" avatar={null} />)

    expect(screen.getByText('AL')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('carries the version in the URL, so a new picture is a new URL', () => {
    render(<Avatar accountId="a-1" name="Ada" avatar="2026-08-05T10:00:00.000Z" />)

    const src = document.querySelector('img')?.getAttribute('src') ?? ''
    expect(src).toContain('/api/accounts/a-1/avatar')
    expect(src).toContain('v=2026-08-05T10%3A00%3A00.000Z')
  })

  it('says nothing to a screen reader, because the name is always beside it', () => {
    render(<Avatar accountId="a-1" name="Ada" avatar="v1" />)

    expect(document.querySelector('img')?.getAttribute('alt')).toBe('')
  })
})

describe('the square a circle wants', () => {
  it('takes the middle of a landscape picture', () => {
    expect(squareCrop(200, 100)).toEqual({ x: 50, y: 0, side: 100 })
  })

  it('takes the middle of a portrait one, where the face usually is', () => {
    expect(squareCrop(100, 200)).toEqual({ x: 0, y: 50, side: 100 })
  })

  it('leaves a square alone', () => {
    expect(squareCrop(120, 120)).toEqual({ x: 0, y: 0, side: 120 })
  })
})
