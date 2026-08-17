import { afterEach, describe, expect, it, vi } from 'vitest'

import { resizedImage, scaledSize } from './image.ts'

describe('the size a picture is drawn at', () => {
  it('leaves one that already fits alone', () => {
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('does not blow a small one up', () => {
    expect(scaledSize(200, 120, 1600)).toEqual({ width: 200, height: 120 })
  })

  it('takes the longest edge down to the cap, keeping the shape', () => {
    expect(scaledSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('measures the longest edge whichever way up the picture is', () => {
    expect(scaledSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('keeps a square square', () => {
    expect(scaledSize(4000, 4000, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('rounds rather than truncates, so an odd ratio does not lose a pixel of shape', () => {
    expect(scaledSize(4001, 2999, 1600)).toEqual({ width: 1600, height: 1199 })
  })
})

describe('reading the file', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
  })

  it('asks the browser to apply the rotation the camera recorded', async () => {
    const asked = vi.fn(() => Promise.reject(new Error('no decoder here')))
    Object.defineProperty(globalThis, 'createImageBitmap', { value: asked, configurable: true })

    await expect(resizedImage(new Blob([new Uint8Array([1])]))).rejects.toThrow()

    expect(asked).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' })
  })
})
