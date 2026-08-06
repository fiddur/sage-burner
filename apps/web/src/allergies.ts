/**
 * What one person cannot eat, in one line (#254).
 *
 * The ticked items and the free text together, because both are answers to the same
 * question and whoever cooks reads one column. An em dash when there is neither, so
 * an empty cell is never mistaken for a row that failed to load.
 */
export const allergiesOf = (person: {
  allergy_items: readonly string[]
  allergies_notes: string | null
}): string => {
  const said = [...person.allergy_items, ...(person.allergies_notes === null ? [] : [person.allergies_notes])]

  return said.length === 0 ? '—' : said.join(', ')
}
