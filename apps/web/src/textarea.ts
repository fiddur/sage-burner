export const MIN_ROWS = 3

export const MAX_ROWS = 24

const NOMINAL_COLUMNS = 72

export const rowsFor = (value: string, min: number = MIN_ROWS): number => {
  const wrapped = value
    .split('\n')
    .reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / NOMINAL_COLUMNS)), 0)

  return Math.min(Math.max(wrapped, min), Math.max(MAX_ROWS, min))
}
