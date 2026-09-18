import { describe, expect, it } from 'vitest'

import type { Eater, Shoppable, ShoppingRow, Sitting, SittingLine, Staying } from './shopping.ts'

import {
  askedSaid,
  buySaid,
  cannotEat,
  haveSaid,
  headcountOn,
  placesSaid,
  roundUp,
  scaled,
  shoppingSections,
  shoppingText,
  staysOver,
  wantedSaid,
} from './shopping.ts'

const thing = (over: Partial<Shoppable> = {}): Shoppable => ({
  id: 'p-1',
  name: 'Oatmeal',
  where: '',
  unit: 'kg',
  stock_level: null,
  stock_amount: null,
  hearts: { count: 1 },
  bought: null,
  allergies: [],
  ...over,
})

const line = (over: Partial<SittingLine> = {}): SittingLine => ({
  id: 'i-1',
  pantry_item_id: 'p-1',
  name: 'Oatmeal',
  unit: 'kg',
  amount: 1,
  bought: null,
  ...over,
})

const sitting = (over: Partial<Sitting> = {}): Sitting => ({
  label: 'Dinner',
  date: '2026-08-01',
  serves: 10,
  lead: null,
  ingredients: [],
  ...over,
})

const staying = (over: Partial<Staying> = {}): Staying => ({
  account_id: 'a-1',
  payment_status: 'paid',
  joined_at: '2026-06-01T00:00:00.000Z',
  arrival_date: null,
  departure_date: null,
  ...over,
})

const eater = (over: Partial<Eater> = {}): Eater => ({
  account_id: 'a-1',
  name: 'Anna L',
  waiting: false,
  arrival_date: null,
  departure_date: null,
  allergy_item_ids: [],
  allergies_notes: '',
  ...over,
})

const list = (over: Partial<Parameters<typeof shoppingSections>[0]> = {}) =>
  shoppingSections({ items: [], sittings: [], entries: [], cap: 42, buying_for: null, ...over })

const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name)

const first = (rows: readonly ShoppingRow[]): ShoppingRow => {
  const [row] = rows
  if (row === undefined) throw new Error('no row to read')

  return row
}

describe('staysOver', () => {
  it('counts a stay with no dates on it as the whole burn', () => {
    expect(staysOver(staying(), '2026-08-02')).toBe(true)
  })

  it('takes the day somebody arrives and the day they leave', () => {
    const short = staying({ arrival_date: '2026-08-02', departure_date: '2026-08-03' })

    expect(staysOver(short, '2026-08-02')).toBe(true)
    expect(staysOver(short, '2026-08-03')).toBe(true)
  })

  it('leaves out the day before somebody comes and the day after they go', () => {
    const short = staying({ arrival_date: '2026-08-02', departure_date: '2026-08-03' })

    expect(staysOver(short, '2026-08-01')).toBe(false)
    expect(staysOver(short, '2026-08-04')).toBe(false)
  })
})

describe('headcountOn', () => {
  it('counts the people whose stay covers the day', () => {
    const entries = [
      staying({ account_id: 'a-1' }),
      staying({ account_id: 'a-2', arrival_date: '2026-08-02' }),
      staying({ account_id: 'a-3', departure_date: '2026-08-01' }),
    ]

    expect(headcountOn(entries, 42, '2026-08-01')).toBe(2)
    expect(headcountOn(entries, 42, '2026-08-02')).toBe(2)
  })

  it('leaves out whoever is on the waiting list', () => {
    const entries = [
      staying({ account_id: 'a-1', joined_at: '2026-06-01T00:00:00.000Z' }),
      staying({ account_id: 'a-2', joined_at: '2026-06-02T00:00:00.000Z' }),
    ]

    expect(headcountOn(entries, 2, '2026-08-01')).toBe(2)
    expect(headcountOn(entries, 1, '2026-08-01')).toBe(1)
  })
})

describe('scaled', () => {
  it('takes the amount from what it feeds to who is there', () => {
    expect(scaled(1, 10, 34)).toBeCloseTo(3.4)
    expect(scaled(4, 10, 40)).toBe(16)
  })
})

describe('roundUp', () => {
  it('rounds a kilo and a litre up to a tenth', () => {
    expect(roundUp(0.11, 'kg')).toBe(0.2)
    expect(roundUp(3.4, 'kg')).toBe(3.4)
    expect(roundUp(1.41, 'l')).toBe(1.5)
  })

  it('rounds everything else up to a whole', () => {
    expect(roundUp(2.01, 'pcs')).toBe(3)
    expect(roundUp(2, 'pcs')).toBe(2)
    expect(roundUp(13.2, 'pkt')).toBe(14)
  })

  it('leaves a number that already lands on the step alone', () => {
    expect(roundUp(4.8, 'kg')).toBe(4.8)
    expect(roundUp(24, 'pcs')).toBe(24)
  })
})

describe('the shopping list', () => {
  it('scales what a sitting asks for to the people there that day', () => {
    const sections = list({
      items: [thing({ name: 'Lentils, red' })],
      sittings: [sitting({ ingredients: [line({ amount: 1 })] })],
      entries: [staying({ account_id: 'a-1' }), staying({ account_id: 'a-2' })],
    })

    expect(sections.pantry[0]?.need).toBe(0.2)
    expect(sections.pantry[0]?.buy).toBe(0.2)
  })

  it('counts each sitting for the people there on its own day', () => {
    const sections = list({
      items: [thing({ unit: 'pcs' })],
      sittings: [
        sitting({ date: '2026-08-01', ingredients: [line({ id: 'i-1', unit: 'pcs', amount: 10 })] }),
        sitting({ date: '2026-08-02', ingredients: [line({ id: 'i-2', unit: 'pcs', amount: 10 })] }),
      ],
      entries: [
        staying({ account_id: 'a-1' }),
        staying({ account_id: 'a-2' }),
        staying({ account_id: 'a-3', arrival_date: '2026-08-02' }),
      ],
      cap: 42,
    })

    expect(sections.pantry[0]?.need).toBe(5)
    expect(sections.pantry[0]?.used_in.map((use) => use.amount)).toEqual([2, 3])
  })

  it('lets a number replace the headcount for every sitting', () => {
    const sections = list({
      items: [thing({ unit: 'pcs' })],
      sittings: [sitting({ ingredients: [line({ unit: 'pcs', amount: 10 })] })],
      entries: [staying()],
      buying_for: 40,
    })

    expect(sections.pantry[0]?.need).toBe(40)
  })

  it('takes off what the pantry says is in the house', () => {
    const sections = list({
      items: [thing({ stock_level: 'some', stock_amount: 2 })],
      sittings: [sitting({ serves: 1, ingredients: [line({ amount: 5 })] })],
      entries: [staying()],
    })

    expect(sections.pantry[0]?.need).toBe(5)
    expect(sections.pantry[0]?.buy).toBe(3)
  })

  it('folds away a thing the house has enough of', () => {
    const sections = list({
      items: [thing({ stock_level: 'some', stock_amount: 9 })],
      sittings: [sitting({ serves: 1, ingredients: [line({ amount: 5 })] })],
      entries: [staying()],
    })

    expect(names(sections.pantry)).toEqual([])
    expect(names(sections.enough)).toEqual(['Oatmeal'])
    expect(sections.enough[0]?.buy).toBe(0)
  })

  it('folds away what there is plenty of, whatever the sittings ask for', () => {
    const sections = list({
      items: [thing({ stock_level: 'plenty' })],
      sittings: [sitting({ serves: 1, ingredients: [line({ amount: 50 })] })],
      entries: [staying()],
    })

    expect(names(sections.enough)).toEqual(['Oatmeal'])
    expect(sections.enough[0]?.buy).toBe(0)
  })

  it('keeps a hearted thing nobody cooks with as the row it was', () => {
    const sections = list({ items: [thing({ hearts: { count: 14 } })] })

    expect(sections.pantry[0]?.need).toBeNull()
    expect(sections.pantry[0]?.buy).toBeNull()
    expect(sections.pantry[0]?.hearts).toBe(14)
  })

  it('leaves out a thing nobody hearted and nobody cooks with', () => {
    const sections = list({ items: [thing({ hearts: { count: 0 } })] })

    expect(names(sections.pantry)).toEqual([])
    expect(names(sections.enough)).toEqual([])
  })

  it('says what is needed even when nobody hearted it', () => {
    const sections = list({
      items: [thing({ hearts: { count: 0 } })],
      sittings: [sitting({ serves: 1, ingredients: [line({ amount: 2 })] })],
      entries: [staying()],
    })

    expect(names(sections.pantry)).toEqual(['Oatmeal'])
  })

  it('asks for nothing for a line with no amount on it', () => {
    const sections = list({
      items: [thing({ hearts: { count: 0 } })],
      sittings: [sitting({ ingredients: [line({ amount: null })] })],
      entries: [staying()],
    })

    expect(sections.pantry[0]?.need).toBeNull()
    expect(sections.pantry[0]?.used_in).toHaveLength(1)
  })

  it('puts what the meals need first, then what most people want', () => {
    const sections = list({
      items: [
        thing({ id: 'p-1', name: 'Bread', hearts: { count: 9 } }),
        thing({ id: 'p-2', name: 'Almonds', hearts: { count: 3 } }),
        thing({ id: 'p-3', name: 'Lentils', hearts: { count: 0 }, unit: 'pcs' }),
      ],
      sittings: [
        sitting({ serves: 1, ingredients: [line({ pantry_item_id: 'p-3', unit: 'pcs', amount: 2 })] }),
      ],
      entries: [staying()],
    })

    expect(names(sections.pantry)).toEqual(['Lentils', 'Bread', 'Almonds'])
  })

  it('lists a special buy apart from the pantry, as the cook wrote it', () => {
    const sections = list({
      sittings: [
        sitting({
          lead: { name: 'Fredrik L' },
          serves: 10,
          ingredients: [
            line({ id: 'i-1', pantry_item_id: null, name: 'Saffron, 1 g sachets', unit: 'pcs', amount: 2 }),
          ],
        }),
      ],
      entries: [staying(), staying({ account_id: 'a-2' })],
    })

    expect(names(sections.special)).toEqual(['Saffron, 1 g sachets'])
    expect(sections.special[0]?.buy).toBe(1)
    expect(sections.special[0]?.ingredient_ids).toEqual(['i-1'])
    expect(sections.special[0]?.used_in[0]?.cook).toBe('Fredrik L')
  })

  it('gathers the same special buy from several sittings into one row', () => {
    const special = { pantry_item_id: null, name: 'Coriander, fresh', unit: 'bunches', amount: 2 }
    const sections = list({
      sittings: [
        sitting({ serves: 1, ingredients: [line({ id: 'i-1', ...special })] }),
        sitting({
          serves: 1,
          date: '2026-08-02',
          ingredients: [line({ id: 'i-2', ...special, name: ' CORIANDER, Fresh ' })],
        }),
      ],
      entries: [staying()],
    })

    expect(sections.special).toHaveLength(1)
    expect(sections.special[0]?.buy).toBe(4)
    expect(sections.special[0]?.ingredient_ids).toEqual(['i-1', 'i-2'])
  })

  it('keeps a pick the pantry no longer stocks on the list, apart from the pantry', () => {
    const sections = list({
      items: [],
      sittings: [sitting({ serves: 1, ingredients: [line({ amount: 2 })] })],
      entries: [staying()],
    })

    expect(names(sections.special)).toEqual(['Oatmeal'])
    expect(sections.special[0]?.ingredient_ids).toEqual(['i-1'])
    expect(sections.special[0]?.pantry_item_id).toBeNull()
  })

  it('keeps two special buys measured differently apart', () => {
    const sections = list({
      sittings: [
        sitting({
          serves: 1,
          ingredients: [
            line({ id: 'i-1', pantry_item_id: null, name: 'Sourdough', unit: 'pcs', amount: 1 }),
            line({ id: 'i-2', pantry_item_id: null, name: 'Sourdough', unit: 'kg', amount: 1 }),
          ],
        }),
      ],
      entries: [staying()],
    })

    expect(sections.special).toHaveLength(2)
  })

  it('calls a special buy bought once every line of it is ticked', () => {
    const at = { by: 'a-1', by_name: 'Ada', at: '2026-07-30T09:00:00.000Z' }
    const later = { by: 'a-1', by_name: 'Ada', at: '2026-07-31T09:00:00.000Z' }
    const special = { pantry_item_id: null, name: 'Saffron', unit: 'pcs', amount: 1 }

    const half = list({
      sittings: [
        sitting({
          serves: 1,
          ingredients: [line({ id: 'i-1', ...special, bought: at }), line({ id: 'i-2', ...special })],
        }),
      ],
      entries: [staying()],
    })

    const whole = list({
      sittings: [
        sitting({
          serves: 1,
          ingredients: [
            line({ id: 'i-1', ...special, bought: at }),
            line({ id: 'i-2', ...special, bought: later }),
          ],
        }),
      ],
      entries: [staying()],
    })

    expect(names(half.special)).toEqual(['Saffron'])
    expect(names(half.bought)).toEqual([])
    expect(names(whole.special)).toEqual([])
    expect(whole.bought[0]?.bought).toEqual(later)
  })

  it('moves a ticked pantry thing over, whatever the pantry says is left', () => {
    const at = { by: 'a-1', by_name: 'Ada', at: '2026-09-17T10:00:00.000Z' }
    const sections = list({ items: [thing({ bought: at })] })

    expect(names(sections.bought)).toEqual(['Oatmeal'])
    expect(names(sections.pantry)).toEqual([])
  })

  it('leaves the list it was given alone', () => {
    const items = [thing({ id: 'p-1', name: 'Bread' }), thing({ id: 'p-2', name: 'Almonds' })]

    list({ items })

    expect(names(items)).toEqual(['Bread', 'Almonds'])
  })
})

describe('haveSaid', () => {
  it('says nothing was counted when nothing was', () => {
    expect(haveSaid(thing())).toBe('not counted')
  })

  it('names each answer the pantry has', () => {
    expect(haveSaid(thing({ stock_level: 'plenty' }))).toBe('have plenty')
    expect(haveSaid(thing({ stock_level: 'out' }))).toBe('have none')
    expect(haveSaid(thing({ stock_level: 'some', stock_amount: 2 }))).toBe('have about 2 kg')
  })

  it('says some without a figure nobody gave', () => {
    expect(haveSaid(thing({ stock_level: 'some' }))).toBe('have some')
  })
})

describe('wantedSaid', () => {
  it('agrees with the number in front of it', () => {
    expect(wantedSaid(1)).toBe('1 wants it')
    expect(wantedSaid(14)).toBe('14 want it')
  })
})

describe('askedSaid', () => {
  it('names the sittings a thing is for, with what each one takes', () => {
    const sections = list({
      items: [thing({ unit: 'pcs' })],
      sittings: [
        sitting({ label: 'Dinner', serves: 1, ingredients: [line({ id: 'i-1', unit: 'pcs', amount: 12 })] }),
        sitting({
          label: 'Lunch',
          date: '2026-08-02',
          serves: 1,
          ingredients: [line({ id: 'i-2', unit: 'pcs', amount: 6 })],
        }),
      ],
      entries: [staying()],
    })

    expect(askedSaid(first(sections.pantry))).toBe('Sat 1 Dinner 12 pcs · Sun 2 Lunch 6 pcs · 1 wants it')
  })

  it('falls back to the hearts when no sitting asks for it', () => {
    const sections = list({ items: [thing({ hearts: { count: 14 } })] })

    expect(askedSaid(first(sections.pantry))).toBe('14 want it')
  })
})

describe('placesSaid', () => {
  it('says how many have a place and how many are there each day', () => {
    const entries = [
      staying({ account_id: 'a-1' }),
      staying({ account_id: 'a-2', arrival_date: '2026-08-02' }),
    ]

    expect(placesSaid(entries, 42, ['2026-08-02', '2026-08-01', '2026-08-02'])).toBe(
      '2 have a place; 1 here on Saturday 1, 2 here on Sunday 2',
    )
  })

  it('says only the places when no sitting has a day', () => {
    expect(placesSaid([staying()], 42, [])).toBe('1 have a place')
  })
})

describe('buySaid', () => {
  it('says nothing for a thing with no amount worked out', () => {
    const sections = list({ items: [thing({ hearts: { count: 3 } })] })

    expect(buySaid(first(sections.pantry))).toBe('')
  })
})

describe('shoppingText', () => {
  it('writes one line per thing to buy, with the amount and where it lives', () => {
    const sections = list({
      items: [thing({ name: 'Oatmeal', where: 'hallway, left white box', hearts: { count: 14 } })],
      sittings: [
        sitting({
          serves: 10,
          ingredients: [
            line({ amount: 1 }),
            line({ id: 'i-2', pantry_item_id: null, name: 'Saffron', unit: 'pcs', amount: 2 }),
          ],
        }),
      ],
      entries: [staying(), staying({ account_id: 'a-2' })],
    })

    expect(shoppingText(sections)).toBe(
      '- Oatmeal · 0.2 kg · Sat 1 Dinner 0.2 kg · 14 want it · hallway, left white box\n' +
        '- Saffron · 1 pcs · Sat 1 Dinner 1 pcs',
    )
  })

  it('leaves out what is ticked and what there is enough of', () => {
    const sections = list({
      items: [
        thing({ id: 'p-1', name: 'Oatmeal' }),
        thing({ id: 'p-2', name: 'Rice', stock_level: 'plenty' }),
        thing({
          id: 'p-3',
          name: 'Bread',
          bought: { by: null, by_name: null, at: '2026-09-17T10:00:00.000Z' },
        }),
      ],
    })

    expect(shoppingText(sections)).toBe('- Oatmeal · 1 wants it')
  })

  it('is empty when there is nothing to buy', () => {
    expect(shoppingText(list())).toBe('')
  })
})

describe('cannotEat', () => {
  const NUTS = 'al-nuts'
  const GLUTEN = 'al-gluten'

  it('names whoever ticked one of the tags the thing carries', () => {
    const anna = eater({ account_id: 'a-1', name: 'Anna L', allergy_item_ids: [NUTS] })
    const bo = eater({ account_id: 'a-2', name: 'Bo K', allergy_item_ids: [GLUTEN] })

    expect(cannotEat([anna, bo], '2026-08-01', [NUTS]).who).toEqual([anna])
  })

  it('names somebody once when two of their ticks are on the same thing', () => {
    const anna = eater({ allergy_item_ids: [NUTS, GLUTEN] })

    expect(cannotEat([anna], '2026-08-01', [NUTS, GLUTEN]).who).toEqual([anna])
  })

  it('leaves out somebody whose stay misses the day', () => {
    const early = eater({ allergy_item_ids: [NUTS], departure_date: '2026-07-31' })
    const late = eater({ account_id: 'a-2', allergy_item_ids: [NUTS], arrival_date: '2026-08-02' })
    const there = eater({ account_id: 'a-3', allergy_item_ids: [NUTS], arrival_date: '2026-08-01' })

    expect(cannotEat([early, late, there], '2026-08-01', [NUTS]).who).toEqual([there])
  })

  it('counts a stay that misses the day when no day is asked about', () => {
    const early = eater({ allergy_item_ids: [NUTS], departure_date: '2026-07-31' })

    expect(cannotEat([early], null, [NUTS]).who).toEqual([early])
  })

  it('leaves out the waiting list', () => {
    const waiting = eater({ allergy_item_ids: [NUTS], waiting: true })

    expect(cannotEat([waiting], '2026-08-01', [NUTS]).who).toEqual([])
  })

  it('names nobody for a thing carrying no tag', () => {
    const anna = eater({ allergy_item_ids: [NUTS] })

    expect(cannotEat([anna], '2026-08-01', []).who).toEqual([])
  })

  it('counts somebody with only free text among the others', () => {
    const wrote = eater({ allergies_notes: 'red lentils make me ill' })

    expect(cannotEat([wrote], '2026-08-01', [NUTS])).toEqual({ who: [], others: 1 })
  })

  it('does not count somebody already named among the others', () => {
    const both = eater({ allergy_item_ids: [NUTS], allergies_notes: 'and red lentils' })

    expect(cannotEat([both], '2026-08-01', [NUTS])).toEqual({ who: [both], others: 0 })
  })

  it('does not count free text from somebody who is not there that day', () => {
    const away = eater({ allergies_notes: 'red lentils', arrival_date: '2026-08-02' })

    expect(cannotEat([away], '2026-08-01', [NUTS]).others).toBe(0)
  })

  it('does not count whitespace as having written something', () => {
    const blank = eater({ allergies_notes: '   ' })

    expect(cannotEat([blank], '2026-08-01', [NUTS]).others).toBe(0)
  })
})
