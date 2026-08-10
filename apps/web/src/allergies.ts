export const allergiesOf = (person: {
  allergy_items: readonly string[]
  allergies_notes: string | null
}): string => {
  const said = [...person.allergy_items, ...(person.allergies_notes === null ? [] : [person.allergies_notes])]

  return said.length === 0 ? '—' : said.join(', ')
}
