export const ROUTE_TO = 'sage-burner:route-to'

export const routeAsked = (data: unknown): string | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  if (Reflect.get(data, 'type') !== ROUTE_TO) return undefined

  const path = Reflect.get(data, 'path')

  return typeof path === 'string' ? path : undefined
}
