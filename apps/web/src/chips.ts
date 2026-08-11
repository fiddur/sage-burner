export const litAfterTap = <T extends string>(all: readonly T[], lit: readonly T[], tapped: T): T[] => {
  if (lit.length === 0) return [tapped]

  const next = lit.includes(tapped) ? lit.filter((one) => one !== tapped) : [...lit, tapped]

  return next.length === all.length ? [] : next
}

export const isLit = <T extends string>(lit: readonly T[], chip: T): boolean =>
  lit.length === 0 || lit.includes(chip)
