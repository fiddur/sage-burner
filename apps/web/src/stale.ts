import { isApiError } from './api/client.ts'

export const isStale = (failure: unknown): boolean =>
  isApiError(failure) && (failure.status === 412 || failure.status === 428)

export const theirVersion = (failure: unknown, path: readonly string[]): string | undefined => {
  if (!isStale(failure) || !isApiError(failure)) return undefined

  let found: unknown = failure.payload
  for (const step of path) {
    if (typeof found !== 'object' || found === null || !(step in found)) return undefined

    found = Reflect.get(found, step)
  }

  return typeof found === 'string' ? found : undefined
}
