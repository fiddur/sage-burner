const messages = (failure: unknown): string[] => {
  const found: string[] = []
  let current = failure
  while (current instanceof Error && found.length < 10) {
    found.push(current.message)
    current = current.cause
  }
  return found
}

const some = (failure: unknown, matches: (message: string) => boolean): boolean =>
  messages(failure).some(matches)

export const isForeignKeyViolation = (failure: unknown): boolean =>
  some(failure, (message) => /FOREIGN KEY constraint failed/i.test(message))

export const isUniqueViolation = (failure: unknown, column?: string): boolean =>
  some(
    failure,
    (message) =>
      /UNIQUE constraint failed/i.test(message) && (column === undefined || message.includes(column)),
  )

export const isCheckViolation = (failure: unknown, name: string): boolean =>
  some(failure, (message) => message.includes(`CHECK constraint failed: ${name}`))
