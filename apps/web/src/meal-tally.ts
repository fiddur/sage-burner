import type { Meal } from '@sage-burner/shared'

type Seat = (meal: Meal) => readonly { account_id: string }[]

const lead: Seat = (meal) => (meal.lead === null ? [] : [meal.lead])
const helpers: Seat = (meal) => meal.helpers
const cleanup: Seat = (meal) => meal.cleanup

export const mealTally =
  (meals: readonly Meal[]) =>
  (accountId: string): string => {
    const count = (seat: Seat) =>
      meals.filter((meal) => seat(meal).some((who) => who.account_id === accountId)).length

    return `${count(lead)} L · ${count(helpers)} H · ${count(cleanup)} C`
  }
