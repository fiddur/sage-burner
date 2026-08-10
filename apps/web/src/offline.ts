import { API_CACHE } from './sw/cache.ts'

export const SERVICE_WORKER_URL = '/sw.js'

export interface WorkerRegistrar {
  register: (url: string) => Promise<unknown>
}

export interface CacheDropper {
  delete: (name: string) => Promise<boolean>
}

export const registerServiceWorker = (
  container: WorkerRegistrar | undefined = globalThis.navigator?.serviceWorker,
): void => {
  if (container === undefined) return

  void container.register(SERVICE_WORKER_URL).catch(() => undefined)
}

export const forgetCachedMemberData = async (
  storage: CacheDropper | undefined = globalThis.caches,
): Promise<boolean> => {
  if (storage === undefined) return false

  try {
    return await storage.delete(API_CACHE)
  } catch {
    return false
  }
}
