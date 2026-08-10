export const isForeignKeyViolation = (failure: unknown): boolean =>
  failure instanceof Error && /FOREIGN KEY constraint failed/i.test(failure.message)

export const isUniqueViolation = (failure: unknown, column?: string): boolean => {
  if (!(failure instanceof Error)) return false
  if (!/UNIQUE constraint failed/i.test(failure.message)) return false

  return column === undefined || failure.message.includes(column)
}

export const isCheckViolation = (failure: unknown, name: string): boolean =>
  failure instanceof Error && failure.message.includes(`CHECK constraint failed: ${name}`)
