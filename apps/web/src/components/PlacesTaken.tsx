import { type Placeable, placesIn } from '@sage-burner/shared'

export const PlacesTaken = ({
  entries,
  cap,
}: {
  entries: readonly Pick<Placeable, 'payment_status'>[]
  cap: number
}) => {
  const places = placesIn(entries, cap)

  return (
    <>
      {places.taken} of {cap} members signed up, {places.paid} paid
      {places.waiting > 0 ? `, ${places.waiting} waiting` : ''}.
    </>
  )
}
