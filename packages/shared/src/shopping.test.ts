import { describe, expect, it } from 'vitest'

import type { Shoppable } from './shopping.ts'

import { haveSaid, shoppingSections, shoppingText, wantedSaid } from './shopping.ts'

const thing = (over: Partial<Shoppable> = {}): Shoppable => ({
  name: 'Oatmeal',
  where: '',
  unit: 'kg',
  stock_level: null,
  stock_amount: null,
  hearts: { count: 1 },
  bought: null,
  ...over,
})

const names = (items: readonly Shoppable[]) => items.map((item) => item.name)

describe('shoppingSections', () => {
  it('leaves out anything nobody has hearted', () => {
    const sections = shoppingSections([thing(), thing({ name: 'Cumin', hearts: { count: 0 } })])

    expect(names(sections.wanted)).toEqual(['Oatmeal'])
    expect(names(sections.enough)).toEqual([])
    expect(names(sections.bought)).toEqual([])
  })

  it('wants what is out, not counted, or only some', () => {
    const sections = shoppingSections([
      thing({ name: 'Out', stock_level: 'out' }),
      thing({ name: 'Uncounted' }),
      thing({ name: 'Some', stock_level: 'some', stock_amount: 2 }),
    ])

    expect(names(sections.wanted)).toEqual(['Out', 'Some', 'Uncounted'])
  })

  it('folds away what there is plenty of', () => {
    const sections = shoppingSections([
      thing({ name: 'Rice', stock_level: 'plenty' }),
      thing({ name: 'Oatmeal' }),
    ])

    expect(names(sections.wanted)).toEqual(['Oatmeal'])
    expect(names(sections.enough)).toEqual(['Rice'])
  })

  it('moves a ticked thing over, whatever the pantry says is left', () => {
    const at = { by: 'a-1', by_name: 'Ada', at: '2026-09-17T10:00:00.000Z' }
    const sections = shoppingSections([
      thing({ name: 'Rice', stock_level: 'plenty', bought: at }),
      thing({ name: 'Oatmeal', bought: at }),
    ])

    expect(names(sections.bought)).toEqual(['Oatmeal', 'Rice'])
    expect(names(sections.wanted)).toEqual([])
    expect(names(sections.enough)).toEqual([])
  })

  it('puts what most people want first, and settles a tie by name', () => {
    const sections = shoppingSections([
      thing({ name: 'apples', hearts: { count: 3 } }),
      thing({ name: 'Bread', hearts: { count: 9 } }),
      thing({ name: 'Almonds', hearts: { count: 3 } }),
    ])

    expect(names(sections.wanted)).toEqual(['Bread', 'Almonds', 'apples'])
  })

  it('leaves the list it was given alone', () => {
    const items = [thing({ name: 'Bread' }), thing({ name: 'Almonds', hearts: { count: 9 } })]

    shoppingSections(items)

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

describe('shoppingText', () => {
  it('writes one line per thing to buy, with where it lives', () => {
    const sections = shoppingSections([
      thing({ name: 'Oatmeal', where: 'hallway, left white box', hearts: { count: 14 } }),
      thing({ name: 'Berries, frozen', hearts: { count: 9 } }),
    ])

    expect(shoppingText(sections)).toBe(
      '- Oatmeal · 14 want it · hallway, left white box\n- Berries, frozen · 9 want it',
    )
  })

  it('leaves out what is ticked and what there is enough of', () => {
    const sections = shoppingSections([
      thing({ name: 'Oatmeal' }),
      thing({ name: 'Rice', stock_level: 'plenty' }),
      thing({ name: 'Bread', bought: { by: null, by_name: null, at: '2026-09-17T10:00:00.000Z' } }),
    ])

    expect(shoppingText(sections)).toBe('- Oatmeal · 1 wants it')
  })

  it('is empty when there is nothing to buy', () => {
    expect(shoppingText(shoppingSections([]))).toBe('')
  })
})
