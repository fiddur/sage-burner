import { placesIn } from '@sage-burner/shared'

export const PlacesTaken = ({ entries, cap }: { entries: readonly unknown[]; cap: number }) => {
  const places = placesIn(entries, cap)

  return (
    <>
      {places.taken} of {cap} places taken
      {places.waiting > 0 ? `, ${places.waiting} waiting` : ''}.
    </>
  )
}
