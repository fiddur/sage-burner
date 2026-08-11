/**
 * An empty lit-set means everything, which is what makes one rule enough: the first tap from
 * there solos a chip rather than hiding it, taps after that toggle one by one, and taking the
 * last one off lands back on everything rather than on an empty page.
 */
export const litAfterTap = <T extends string>(all: readonly T[], lit: readonly T[], tapped: T): T[] => {
  if (lit.length === 0) return [tapped]

  const next = lit.includes(tapped) ? lit.filter((one) => one !== tapped) : [...lit, tapped]

  return next.length === all.length ? [] : next
}

export const isLit = <T extends string>(lit: readonly T[], chip: T): boolean =>
  lit.length === 0 || lit.includes(chip)
