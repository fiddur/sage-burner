import { describe, expect, it } from 'vitest'

import { apiError } from './api/client.ts'
import {
  freePlaceholder,
  imageMarkdown,
  insertAt,
  messageForFailure,
  replaceFirst,
  uploadPlaceholder,
} from './image-upload.ts'

describe('what stands in while the bytes go up', () => {
  it('names the file, so several in flight are told apart by eye', () => {
    expect(uploadPlaceholder('sauna.jpg')).toBe('![Uploading sauna.jpg…]()')
  })

  it('takes a second one for the same name rather than repeating itself', () => {
    // The finished upload finds its own placeholder by matching the text, because an
    // offset is wrong the moment somebody types. Two identical ones would let the first
    // upload to land replace the wrong picture.
    const held = `here ${uploadPlaceholder('sauna.jpg')}`

    expect(freePlaceholder(held, 'sauna.jpg')).toBe('![Uploading sauna.jpg (2)…]()')
  })

  it('gives the first one the plain name', () => {
    expect(freePlaceholder('nothing here yet', 'sauna.jpg')).toBe('![Uploading sauna.jpg…]()')
  })

  it('keeps going past a second collision', () => {
    const held = `${uploadPlaceholder('sauna.jpg')} ${uploadPlaceholder('sauna.jpg (2)')}`

    expect(freePlaceholder(held, 'sauna.jpg')).toBe('![Uploading sauna.jpg (3)…]()')
  })
})

describe('writing into what somebody is typing', () => {
  it('puts it at the cursor', () => {
    expect(insertAt('the fire is lit', 4, 'big ')).toBe('the big fire is lit')
  })

  it('appends at the end and prepends at the start', () => {
    expect(insertAt('lit', 3, '!')).toBe('lit!')
    expect(insertAt('lit', 0, 'now ')).toBe('now lit')
  })

  it('clamps a cursor that no longer fits the text', () => {
    // The field is controlled and the value can shrink between the event and the write.
    expect(insertAt('lit', 99, '!')).toBe('lit!')
    expect(insertAt('lit', -5, '!')).toBe('!lit')
  })

  it('replaces the first match only, leaving a later copy alone', () => {
    expect(replaceFirst('a x b x c', 'x', 'y')).toBe('a y b x c')
  })

  it('leaves the text alone when what it is looking for has been typed away', () => {
    // Somebody deleting the placeholder mid-upload must not have the picture reappear.
    expect(replaceFirst('gone now', '![Uploading a.png…]()', '![](/api/images/1)')).toBe('gone now')
  })

  it('writes the picture as a site-relative source, which is what the renderer allows', () => {
    expect(imageMarkdown('abc')).toBe('![](/api/images/abc)')
  })

  it('escapes an id in the path rather than trusting it', () => {
    expect(imageMarkdown('a/b')).toBe('![](/api/images/a%2Fb)')
  })
})

describe('why the picture did not go up', () => {
  it('sends nobody after their file when the session went', () => {
    const message = messageForFailure(apiError(401, 'unauthenticated', 'unauthenticated'))

    expect(message).toContain('signed out')
    expect(message).not.toContain('JPEG')
  })

  it('says what the ceiling is when there is no room for another', () => {
    expect(messageForFailure(apiError(409, 'conflict', 'conflict'))).toContain('as many pictures')
  })

  it('names the formats when the server refused the bytes', () => {
    expect(messageForFailure(apiError(415, 'bad_request', 'bad_request'))).toContain('JPEG')
  })

  it('names the formats when the browser could not read the file at all', () => {
    expect(messageForFailure(new Error('The source image cannot be decoded.'))).toContain('JPEG')
  })

  it('passes the network message through, connection advice and all', () => {
    expect(messageForFailure(apiError(0, 'network', 'Check your connection.'))).toBe('Check your connection.')
  })

  it('says nothing about formats for a server that simply fell over', () => {
    const message = messageForFailure(apiError(500, 'internal', 'internal'))

    expect(message).toContain('Please try again')
    expect(message).not.toContain('JPEG')
  })
})
