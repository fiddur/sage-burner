import type {
  AllergyItem,
  PantryHearts,
  PantryItem,
  PantryKind,
  PantryPlace,
  SpecialBuy,
  SpecialBuyLine,
  StockLevel,
} from '@sage-burner/shared'
import type { Ref } from 'preact'

import {
  bySpot,
  dayName,
  isPantryKind,
  MAX_OPTION_LABEL,
  MAX_PANTRY_NOTE,
  MAX_SPOT,
  MAX_UNIT,
  pantryKindLabel,
  pantryKinds,
  pantryPage,
  PLACE_PARAM,
  spotIn,
  stockLevelLabel,
  stockLevels,
  whereSaid,
} from '@sage-burner/shared'
import { useLocation } from 'preact-iso'
import { useRef, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useSelectedBurn } from '../burn.tsx'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Heart } from '../components/Heart.tsx'
import { IconButton } from '../components/IconButton.tsx'
import { PantryNote } from '../components/PantryNote.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { NAMELESS } from '../components/PersonBadge.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localMoment } from '../datetime.ts'
import { joinFirst, joinLink } from '../joining.ts'
import { errorMessage, useAction, useLoad } from '../load.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type PantryApi = Pick<
  ApiClient,
  | 'addPantryItem'
  | 'adoptSpecialBuy'
  | 'flagPantryNeedMore'
  | 'getAllergyItems'
  | 'getEventPantry'
  | 'getPantry'
  | 'getPantryPlaces'
  | 'getSpecialBuys'
  | 'heartPantryItem'
  | 'putPantrySpot'
  | 'removePantrySpot'
  | 'restorePantryItem'
  | 'setPantryStock'
  | 'unflagPantryNeedMore'
  | 'unheartPantryItem'
  | 'updatePantryItem'
  | 'withdrawPantryItem'
>

export type PantryFilter = 'all' | 'not-counted' | PantryKind

export const pantryFilters: readonly { id: PantryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...pantryKinds.map((kind) => ({ id: kind, label: pantryKindLabel[kind] })),
  { id: 'not-counted', label: 'Not counted' },
]

const spotted = (item: PantryItem, place: string) => ({
  name: item.name,
  spot: spotIn(item.places, place) ?? '',
})

export const shownPantry = (
  items: readonly PantryItem[],
  { filter, search, place }: { filter: PantryFilter; search: string; place?: string },
): PantryItem[] => {
  const wanted = search.trim().toLowerCase()

  const shown = items.filter((item) => {
    if (item.withdrawn_at !== null) return false
    if (place !== undefined && spotIn(item.places, place) === undefined) return false
    if (filter === 'not-counted' && item.stock_level !== null) return false
    if (filter !== 'all' && filter !== 'not-counted' && item.kind !== filter) return false

    return wanted === '' || item.name.toLowerCase().includes(wanted)
  })

  return place === undefined
    ? shown
    : shown.sort((one, other) => bySpot(spotted(one, place), spotted(other, place)))
}

const elsewhere = (item: PantryItem, place: string | undefined): string =>
  whereSaid(item.places.filter((one) => one.place_id !== place))

const TAKEN =
  'Something on the list is already called that. Give this one another name, or put the one that was taken off back.'

const nameClash = (fallback: string) => (failure: unknown) =>
  isApiError(failure) && failure.status === 409 ? TAKEN : errorMessage(failure, fallback)

interface Placing {
  place_id: string
  spot: string
}

interface PantryDraft {
  kind: PantryKind
  name: string
  unit: string
  note: string
  places: Placing[]
}

interface PantryEdit extends PantryDraft {
  allergy_item_ids: string[]
}

const BLANK: PantryDraft = { kind: 'staple', name: '', unit: 'pcs', note: '', places: [] }

const nothing = (): {
  items: readonly PantryItem[]
  hearts: ReadonlyMap<string, PantryHearts>
  allergies: readonly AllergyItem[]
  places: readonly PantryPlace[]
  buys: readonly SpecialBuy[]
} => ({ items: [], hearts: new Map(), allergies: [], places: [], buys: [] })

const sittingSaid = (on: { meal_label: string; date: string; event_name: string }): string =>
  `${on.event_name}: ${dayName(on.date, 'short')} ${on.meal_label}`

const writtenOn = (buy: SpecialBuy): string =>
  [`${buy.sittings} sitting${buy.sittings === 1 ? '' : 's'}`, sittingSaid(buy.sample)].join(' · ')

const adoptedSaid = (adopted: number): string =>
  `${adopted} line${adopted === 1 ? '' : 's'} now point${adopted === 1 ? 's' : ''} at the pantry.`

const writtenAs = (line: SpecialBuyLine, unit: string): string =>
  line.amount === null ? 'to taste' : `${line.amount} ${unit}`

const unitOf = (draft: PantryDraft): string => (draft.unit.trim() === '' ? 'pcs' : draft.unit.trim())

const sameUnit = (one: string, other: string): boolean =>
  one.trim().toLowerCase() === other.trim().toLowerCase()

const amountsFor = (
  adjusting: boolean,
  typed: Readonly<Record<string, string>>,
): Record<string, number | null> =>
  adjusting
    ? Object.fromEntries(
        Object.entries(typed).map(([id, text]) => [id, text.trim() === '' ? null : Number(text)]),
      )
    : {}

const toAdjust = (
  promoting: SpecialBuy | undefined,
  adjusting: boolean,
  unit: string,
): Record<string, string> | undefined =>
  promoting === undefined || adjusting || sameUnit(unit, promoting.unit)
    ? undefined
    : Object.fromEntries(
        promoting.lines.map((line) => [line.id, line.amount === null ? '' : String(line.amount)]),
      )

export const Pantry = ({ api }: { api: PantryApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const burn = useSelectedBurn()
  const { query, route } = useLocation()
  const asked: string | undefined = query?.[PLACE_PARAM]
  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      const [all, wanted, allergies, rooms, written] = await Promise.all([
        api.getPantry(signal),
        burn === undefined ? undefined : api.getEventPantry(burn.event.id, signal),
        api.getAllergyItems(signal),
        api.getPantryPlaces(signal),
        admin ? api.getSpecialBuys(signal) : undefined,
      ])

      return {
        items: all.items,
        hearts: new Map((wanted?.items ?? []).map((one) => [one.id, one.hearts])),
        allergies: allergies.items,
        places: rooms.places,
        buys: written?.buys ?? [],
      }
    },
    {
      enabled: isApproved(viewer),
      key: burn?.event.id ?? '',
      fallback: 'Could not load the pantry.',
      remember: 'pantry',
    },
  )
  const { busy, error, setError, run } = useAction(reload)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PantryFilter>('all')
  const [counting, setCounting] = useState(false)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState(BLANK)
  const [promoting, setPromoting] = useState<SpecialBuy | undefined>(undefined)
  const [adjusting, setAdjusting] = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [promoted, setPromoted] = useState<string | undefined>(undefined)
  const form = useRef<HTMLFormElement>(null)

  const { items, hearts, allergies, places, buys } = loaded.status === 'ready' ? loaded.data : nothing()
  const here = places.find((one) => one.id === asked)
  const shown = shownPantry(items, { filter, search, place: here?.id })
  const gone = items.filter((item) => item.withdrawn_at !== null)

  const count = (item: PantryItem, level: null | StockLevel, amount: number | null) => {
    run(
      () => api.setPantryStock(item.id, { amount: level === 'some' ? amount : null, level }),
      'Could not save that count.',
    )
  }

  const asking = (item: PantryItem) => {
    run(
      () => (item.need_more === null ? api.flagPantryNeedMore(item.id) : api.unflagPantryNeedMore(item.id)),
      'Could not save that.',
    )
  }

  const wanting = (itemId: string, hearting: boolean) => {
    if (burn === undefined) return

    run(
      () =>
        hearting ? api.heartPantryItem(burn.event.id, itemId) : api.unheartPantryItem(burn.event.id, itemId),
      joinFirst('Could not save that.'),
    )
  }

  const putting = (itemId: string, placeId: string, spot: string) => {
    run(() => api.putPantrySpot(itemId, placeId, { spot }), 'Could not save where that is.')
  }

  const put = () => {
    if (draft.name.trim() === '') {
      setError('A thing needs a name before it can go on the list.')
      return
    }

    const unit = unitOf(draft)

    const adjust = toAdjust(promoting, adjusting, unit)

    if (adjust !== undefined) {
      setAmounts(adjust)
      setAdjusting(true)

      return
    }

    run(async () => {
      const added = await api.addPantryItem({
        kind: draft.kind,
        name: draft.name.trim(),
        unit,
        note: draft.note.trim(),
        places: draft.places,
      })

      if (promoting !== undefined) {
        const moved = await api.adoptSpecialBuy(added.item.id, {
          name: promoting.name,
          unit: promoting.unit,
          amounts: amountsFor(adjusting, amounts),
        })
        setPromoted(adoptedSaid(moved.adopted))
      }

      setDraft(BLANK)
      setPromoting(undefined)
      setAdjusting(false)
      setAmounts({})
    }, nameClash('Could not add that.'))
  }

  const promote = (buy: SpecialBuy) => {
    setDraft({ ...BLANK, name: buy.name, unit: buy.unit })
    setPromoting(buy)
    setPromoted(undefined)
    setAdjusting(false)
    setAmounts({})
    form.current?.scrollIntoView?.({ behavior: 'smooth' })
  }

  return (
    <GuardedPage title="Pantry" require="approved">
      <h1>
        Pantry <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What the house usually has, where it lives and roughly how much. Counting is everybody’s — a full sack
        is plenty, half a bucket is some, an empty box is out. It belongs to no one burn.
      </p>

      <ErrorText message={error} link={joinLink(error)} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && (
        <>
          <label class="field">
            <span>Find a thing</span>
            <input
              type="search"
              name="search"
              value={search}
              onInput={(typed) => setSearch(typed.currentTarget.value)}
            />
          </label>

          <KindChips filter={filter} onFilter={setFilter} />

          <CountingChip counting={counting} onCounting={setCounting} />

          <PlaceChips places={places} here={here} onChoose={(id) => route(pantryPage(id))} />

          {shown.length === 0 ? (
            <p class="form-note">
              {here === undefined ? 'Nothing here to count.' : `Nothing is in the ${here.name} yet.`}
            </p>
          ) : (
            <ul class="pantry-list">
              {shown.map((item) => (
                <li key={item.id} class="pantry-row">
                  {editing === item.id ? (
                    <ItemFields
                      item={item}
                      allergies={allergies}
                      places={places}
                      busy={busy}
                      onCancel={() => setEditing(undefined)}
                      onSave={(changes) =>
                        run(async () => {
                          await api.updatePantryItem(item.id, changes)
                          setEditing(undefined)
                        }, nameClash('Could not save that.'))
                      }
                    />
                  ) : (
                    <Row
                      item={item}
                      admin={admin}
                      busy={busy}
                      counting={counting}
                      here={here}
                      hearts={hearts.get(item.id)}
                      onHeart={(hearting) => wanting(item.id, hearting)}
                      onCount={(level, amount) => count(item, level, amount)}
                      onNeedMore={() => asking(item)}
                      onSpot={(spot) => here !== undefined && putting(item.id, here.id, spot)}
                      onOut={() =>
                        here !== undefined &&
                        run(
                          () => api.removePantrySpot(item.id, here.id),
                          'Could not take that out of the room.',
                        )
                      }
                      onEdit={() => setEditing(item.id)}
                      onWithdraw={() =>
                        run(() => api.withdrawPantryItem(item.id), 'Could not take that off.')
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {here !== undefined && (
            <PutSomethingHere
              items={items}
              place={here}
              admin={admin}
              busy={busy}
              onPut={(itemId, spot) => putting(itemId, here.id, spot)}
              onNew={(name) => setDraft({ ...BLANK, name, places: [{ place_id: here.id, spot: '' }] })}
            />
          )}

          {admin && (
            <AddAThing
              draft={draft}
              places={places}
              busy={busy}
              promoting={promoting}
              promoted={promoted}
              adjusting={adjusting}
              amounts={amounts}
              form={form}
              onChange={setDraft}
              onAmount={(id, amount) => setAmounts((held) => ({ ...held, [id]: amount }))}
              onBack={() => setAdjusting(false)}
              onAdd={put}
            />
          )}

          {admin && <WrittenOnSittings buys={buys} busy={busy} onPromote={promote} />}

          {admin && (
            <TakenOff
              items={gone}
              busy={busy}
              onRestore={(id) => run(() => api.restorePantryItem(id), 'Could not put that back.')}
            />
          )}
        </>
      )}
    </GuardedPage>
  )
}

const KindChips = ({
  filter,
  onFilter,
}: {
  filter: PantryFilter
  onFilter: (filter: PantryFilter) => void
}) => (
  <p class="chip-row" role="group" aria-label="What to show">
    {pantryFilters.map((one) => (
      <button
        key={one.id}
        type="button"
        class={filter === one.id ? 'chip is-on' : 'chip'}
        aria-pressed={filter === one.id}
        onClick={() => onFilter(one.id)}
      >
        {one.label}
      </button>
    ))}
  </p>
)

const CountingChip = ({
  counting,
  onCounting,
}: {
  counting: boolean
  onCounting: (counting: boolean) => void
}) => (
  <p class="chip-row">
    <button
      type="button"
      class={counting ? 'chip is-on' : 'chip'}
      aria-pressed={counting}
      onClick={() => onCounting(!counting)}
    >
      Inventory management
    </button>
  </p>
)

const PlaceChips = ({
  places,
  here,
  onChoose,
}: {
  places: readonly PantryPlace[]
  here: PantryPlace | undefined
  onChoose: (placeId: string | undefined) => void
}) => {
  if (places.length === 0) return null

  return (
    <>
      <p class="chip-row" role="group" aria-label="Which room to walk">
        {places.map((one) => (
          <button
            key={one.id}
            type="button"
            class={here?.id === one.id ? 'chip is-on' : 'chip'}
            aria-pressed={here?.id === one.id}
            onClick={() => onChoose(here?.id === one.id ? undefined : one.id)}
          >
            {one.name}
          </button>
        ))}
      </p>

      {here !== undefined && (
        <p class="form-note">
          Taking inventory in the {here.name}, box by box. Tap a box to write where the thing has moved to, or
          ✕ to say it is not in this room any more.
        </p>
      )}
    </>
  )
}

const AddAThing = ({
  draft,
  places,
  busy,
  promoting,
  promoted,
  adjusting,
  amounts,
  form,
  onAdd,
  onAmount,
  onBack,
  onChange,
}: {
  draft: PantryDraft
  places: readonly PantryPlace[]
  busy: boolean
  promoting: SpecialBuy | undefined
  promoted: string | undefined
  adjusting: boolean
  amounts: Readonly<Record<string, string>>
  form: Ref<HTMLFormElement>
  onAdd: () => void
  onAmount: (lineId: string, amount: string) => void
  onBack: () => void
  onChange: (change: (held: PantryDraft) => PantryDraft) => void
}) => (
  <form
    class="form"
    ref={form}
    onSubmit={(submitted) => {
      submitted.preventDefault()
      onAdd()
    }}
  >
    <h2>Add a thing</h2>

    {promoting !== undefined && (
      <p class="form-note">
        Saving puts it on the list and points every line written “{promoting.name} · {promoting.unit}” at it.
      </p>
    )}

    <label class="field">
      <span>What is it?</span>
      <input
        type="text"
        name="name"
        maxLength={MAX_OPTION_LABEL}
        value={draft.name}
        onInput={(typed) => onChange((held) => ({ ...held, name: typed.currentTarget.value }))}
      />
    </label>

    <label class="field">
      <span>What kind of thing?</span>
      <select
        name="kind"
        value={draft.kind}
        onChange={(chosen) => {
          const kind = chosen.currentTarget.value
          if (isPantryKind(kind)) onChange((held) => ({ ...held, kind }))
        }}
      >
        {pantryKinds.map((kind) => (
          <option key={kind} value={kind}>
            {pantryKindLabel[kind]}
          </option>
        ))}
      </select>
    </label>

    <label class="field">
      <span>Counted in</span>
      <input
        type="text"
        name="unit"
        maxLength={MAX_UNIT}
        value={draft.unit}
        onInput={(typed) => onChange((held) => ({ ...held, unit: typed.currentTarget.value }))}
      />
    </label>

    <label class="field">
      <span>Note</span>
      <input
        type="text"
        name="note"
        maxLength={MAX_PANTRY_NOTE}
        value={draft.note}
        onInput={(typed) => onChange((held) => ({ ...held, note: typed.currentTarget.value }))}
      />
    </label>

    <p class="form-note">{NOTE_IS_FOR}</p>

    <PlaceFields
      what="the new thing"
      places={places}
      held={draft.places}
      busy={busy}
      onChange={(wanted) => onChange((held) => ({ ...held, places: wanted }))}
    />

    {adjusting && promoting !== undefined ? (
      <AdjustAmounts
        buy={promoting}
        unit={unitOf(draft)}
        amounts={amounts}
        busy={busy}
        onAmount={onAmount}
        onBack={onBack}
      />
    ) : (
      <PendingButton busy={busy} label="Add it" busyLabel="Adding…" type="submit" />
    )}

    {promoted !== undefined && <p class="form-note">{promoted}</p>}
  </form>
)

const NOTE_IS_FOR =
  'What a cook should know when writing an amount: how a kg turns into dl, that it is dry weight, what a jar holds.'

const AdjustAmounts = ({
  buy,
  unit,
  amounts,
  busy,
  onAmount,
  onBack,
}: {
  buy: SpecialBuy
  unit: string
  amounts: Readonly<Record<string, string>>
  busy: boolean
  onAmount: (lineId: string, amount: string) => void
  onBack: () => void
}) => (
  <fieldset class="pantry-adjust">
    <legend>Adjust the amounts</legend>

    <p class="form-note">
      The pantry will count {buy.name} in {unit}, and the lines were written in {buy.unit}. Say what each one
      becomes.
    </p>

    {buy.lines.map((line) => (
      <p key={line.id} class="row">
        <span>
          {sittingSaid(line)} · {writtenAs(line, buy.unit)} →
        </span>
        <span class="pantry-adjust-amount">
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            aria-label={`How much ${buy.name} on ${sittingSaid(line)}, in ${unit}`}
            disabled={busy}
            value={amounts[line.id] ?? ''}
            onInput={(typed) => onAmount(line.id, typed.currentTarget.value)}
          />
          <span>{unit}</span>
        </span>
      </p>
    ))}

    <p class="row">
      <PendingButton busy={busy} label="Promote" busyLabel="Promoting…" type="submit" />
      <button type="button" class="link-button" disabled={busy} onClick={onBack}>
        Back
      </button>
    </p>
  </fieldset>
)

const WrittenOnSittings = ({
  buys,
  busy,
  onPromote,
}: {
  buys: readonly SpecialBuy[]
  busy: boolean
  onPromote: (buy: SpecialBuy) => void
}) => {
  if (buys.length === 0) return null

  return (
    <section>
      <h2>Written on sittings, not in the pantry</h2>
      <p class="form-note">
        What cooks have written by hand for a burn still to come. Something written again and again is
        something the house keeps — promote it, and the lines already written point at it.
      </p>
      <ul class="pantry-list">
        {buys.map((buy) => (
          <li key={`${buy.name} · ${buy.unit}`} class="pantry-row">
            <div class="pantry-what">
              <strong>{buy.name}</strong> <span class="pantry-kind">{buy.unit}</span>
            </div>
            <p class="form-note">{writtenOn(buy)}</p>
            <p class="pantry-actions">
              <button
                type="button"
                aria-label={`Promote ${buy.name} to the pantry`}
                disabled={busy}
                onClick={() => onPromote(buy)}
              >
                Promote
              </button>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

const TakenOff = ({
  items,
  busy,
  onRestore,
}: {
  items: readonly PantryItem[]
  busy: boolean
  onRestore: (id: string) => void
}) => {
  if (items.length === 0) return null

  return (
    <section>
      <h2>Taken off</h2>
      <p class="form-note">
        Nobody counts these any more. The name is still taken, so putting one back beats typing it again.
      </p>
      <ul class="pantry-list">
        {items.map((item) => (
          <li key={item.id} class="pantry-row is-gone">
            <span>{item.name}</span>
            <IconButton
              icon="restore"
              label={`Put ${item.name} back on the list`}
              disabled={busy}
              onClick={() => onRestore(item.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

const countedBy = (item: PantryItem): string | undefined => {
  if (item.counted_at === null) return undefined

  const who = item.counted_by === null ? 'somebody who has left' : (item.counted_by_name ?? NAMELESS)

  return `Counted by ${who} · ${localMoment(item.counted_at)}`
}

const askedFor = (item: PantryItem): string | undefined => {
  if (item.need_more === null) return undefined

  const when = localMoment(item.need_more.at)

  return item.need_more.by === null
    ? `Need more · ${when}`
    : `Need more, asked by ${item.need_more.by_name ?? NAMELESS} · ${when}`
}

const countSaid = (item: PantryItem): string => {
  if (item.stock_level === null) return ''
  if (item.stock_level !== 'some') return stockLevelLabel[item.stock_level].toLowerCase()

  return item.stock_amount === null ? 'some' : `~${item.stock_amount} ${item.unit}`
}

const stateSaid = (item: PantryItem, where: string): string =>
  [where, countSaid(item), item.need_more === null ? '' : 'need more']
    .filter((part) => part !== '')
    .join(' · ')

const Row = ({
  item,
  admin,
  busy,
  counting,
  here,
  hearts,
  onCount,
  onEdit,
  onHeart,
  onNeedMore,
  onOut,
  onSpot,
  onWithdraw,
}: {
  item: PantryItem
  admin: boolean
  busy: boolean
  counting: boolean
  here: PantryPlace | undefined
  hearts: PantryHearts | undefined
  onCount: (level: null | StockLevel, amount: number | null) => void
  onEdit: () => void
  onHeart: (hearting: boolean) => void
  onNeedMore: () => void
  onOut: () => void
  onSpot: (spot: string) => void
  onWithdraw: () => void
}) => {
  const where = here === undefined ? whereSaid(item.places) : elsewhere(item, here.id)
  const state = stateSaid(item, where)

  return (
    <>
      <div class="pantry-what">
        {here !== undefined && (
          <Spot
            item={item}
            place={here}
            spot={spotIn(item.places, here.id) ?? ''}
            busy={busy}
            onSpot={onSpot}
            onOut={onOut}
          />
        )}
        <strong>{item.name}</strong>
        <span class="pantry-kind">{pantryKindLabel[item.kind]}</span>
        <PantryNote what={item.name} note={item.note} />
        {item.allergies.map((tag) => (
          <span key={tag.id} class="allergy-tag">
            {tag.label}
          </span>
        ))}
        {hearts !== undefined && (
          <Heart
            what={item.name}
            hearted={hearts.mine}
            count={hearts.count}
            people={hearts.people}
            busy={busy}
            onHeart={onHeart}
          />
        )}
        {!counting && state !== '' && <span class="pantry-state">{state}</span>}
      </div>

      {counting && (
        <Counting
          item={item}
          admin={admin}
          busy={busy}
          where={where}
          onCount={onCount}
          onEdit={onEdit}
          onNeedMore={onNeedMore}
          onWithdraw={onWithdraw}
        />
      )}
    </>
  )
}

const Counting = ({
  item,
  admin,
  busy,
  where,
  onCount,
  onEdit,
  onNeedMore,
  onWithdraw,
}: {
  item: PantryItem
  admin: boolean
  busy: boolean
  where: string
  onCount: (level: null | StockLevel, amount: number | null) => void
  onEdit: () => void
  onNeedMore: () => void
  onWithdraw: () => void
}) => {
  const said = countedBy(item)
  const asked = askedFor(item)

  return (
    <>
      {where !== '' && <p class="form-note">{where}</p>}
      {said !== undefined && <p class="form-note">{said}</p>}
      {asked !== undefined && <p class="form-note">{asked}</p>}

      <div class="stock-choice">
        <p class="stock-steps" role="group" aria-label={`How much ${item.name} is left`}>
          {stockLevels.map((level) => (
            <button
              key={level}
              type="button"
              class={item.stock_level === level ? 'stock-step is-on' : 'stock-step'}
              aria-pressed={item.stock_level === level}
              disabled={busy}
              onClick={() => onCount(item.stock_level === level ? null : level, item.stock_amount)}
            >
              {stockLevelLabel[level]}
            </button>
          ))}

          {item.stock_level === 'some' && (
            <Amount item={item} busy={busy} onAmount={(amount) => onCount('some', amount)} />
          )}
        </p>

        <p class="stock-steps">
          <button
            type="button"
            class={item.need_more === null ? 'stock-step' : 'stock-step is-on'}
            aria-pressed={item.need_more !== null}
            aria-label={`${item.need_more === null ? 'Ask for more' : 'Stop asking for more'} ${item.name}`}
            disabled={busy}
            onClick={onNeedMore}
          >
            Need more
          </button>
        </p>
      </div>

      {admin && (
        <p class="pantry-actions">
          <IconButton icon="edit" label={`Edit ${item.name}`} disabled={busy} onClick={onEdit} />
          <Destroy what={item.name} verb="Take off" busy={busy} onDestroy={onWithdraw} />
        </p>
      )}
    </>
  )
}

const NO_BOX = 'no box'

const Spot = ({
  item,
  place,
  spot,
  busy,
  onOut,
  onSpot,
}: {
  item: PantryItem
  place: PantryPlace
  spot: string
  busy: boolean
  onOut: () => void
  onSpot: (spot: string) => void
}) => {
  const [writing, setWriting] = useState(false)
  const [typed, setTyped] = useState(spot)

  const save = () => {
    setWriting(false)
    if (typed.trim() !== spot) onSpot(typed.trim())
  }

  return (
    <span class="pantry-spot">
      {writing ? (
        <input
          type="text"
          maxLength={MAX_SPOT}
          aria-label={`Where ${item.name} is in the ${place.name}`}
          disabled={busy}
          value={typed}
          onInput={(entered) => setTyped(entered.currentTarget.value)}
          onBlur={save}
          onKeyDown={(pressed) => {
            if (pressed.key === 'Enter') {
              pressed.preventDefault()
              save()
            }
          }}
        />
      ) : (
        <button
          type="button"
          class="spot-tag"
          aria-label={`Write where ${item.name} is in the ${place.name}`}
          disabled={busy}
          onClick={() => {
            setTyped(spot)
            setWriting(true)
          }}
        >
          {spot === '' ? NO_BOX : spot}
        </button>
      )}

      <IconButton
        icon="close"
        label={`Take ${item.name} out of the ${place.name}`}
        disabled={busy}
        onClick={onOut}
      />
    </span>
  )
}

const MATCHES = 6

const PutSomethingHere = ({
  items,
  place,
  admin,
  busy,
  onNew,
  onPut,
}: {
  items: readonly PantryItem[]
  place: PantryPlace
  admin: boolean
  busy: boolean
  onNew: (name: string) => void
  onPut: (itemId: string, spot: string) => void
}) => {
  const [looking, setLooking] = useState('')
  const [picked, setPicked] = useState<PantryItem | undefined>(undefined)
  const [spot, setSpot] = useState('')

  const matches = items
    .filter(
      (item) =>
        item.withdrawn_at === null &&
        spotIn(item.places, place.id) === undefined &&
        item.name.toLowerCase().includes(looking.trim().toLowerCase()),
    )
    .slice(0, MATCHES)

  if (picked !== undefined) {
    return (
      <section class="pantry-put">
        <h2>Put something in the {place.name}</h2>
        <p class="row">
          <span class="ingredient-name">{picked.name}</span>
          <input
            type="text"
            maxLength={MAX_SPOT}
            placeholder="Which box?"
            aria-label={`Where ${picked.name} goes in the ${place.name}`}
            disabled={busy}
            value={spot}
            onInput={(typed) => setSpot(typed.currentTarget.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onPut(picked.id, spot.trim())
              setPicked(undefined)
              setLooking('')
              setSpot('')
            }}
          >
            Put it here
          </button>
          <button type="button" class="link-button" disabled={busy} onClick={() => setPicked(undefined)}>
            Cancel
          </button>
        </p>
      </section>
    )
  }

  return (
    <section class="pantry-put">
      <h2>Put something in the {place.name}</h2>

      <label class="field">
        <span>What did you find?</span>
        <input
          type="text"
          maxLength={MAX_OPTION_LABEL}
          disabled={busy}
          value={looking}
          onInput={(typed) => setLooking(typed.currentTarget.value)}
          onKeyDown={(pressed) => {
            if (pressed.key !== 'Enter') return

            pressed.preventDefault()
            const [first] = matches
            if (looking.trim() !== '' && first !== undefined) {
              setSpot('')
              setPicked(first)
            }
          }}
        />
      </label>

      {looking.trim() !== '' && (
        <div class="ingredient-matches">
          {matches.map((item) => (
            <button
              key={item.id}
              type="button"
              class="ingredient-match"
              disabled={busy}
              onClick={() => {
                setSpot('')
                setPicked(item)
              }}
            >
              <span>
                {item.name} <span class="form-note">{item.unit}</span>
              </span>
              <span class="form-note">
                {item.places.length === 0 ? 'in no room yet' : whereSaid(item.places)}
              </span>
            </button>
          ))}

          {admin ? (
            <button
              type="button"
              class="ingredient-match"
              disabled={busy}
              onClick={() => onNew(looking.trim())}
            >
              <span>Add a new thing called “{looking.trim()}”</span>
              <span class="form-note">Fills in the form below, in this room</span>
            </button>
          ) : (
            <p class="form-note">
              Nothing on the list is called that. Ask an admin to put it on, and it can live here.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const Amount = ({
  item,
  busy,
  onAmount,
}: {
  item: PantryItem
  busy: boolean
  onAmount: (amount: number | null) => void
}) => {
  const [typed, setTyped] = useState(item.stock_amount === null ? '' : String(item.stock_amount))

  const save = () => {
    const wanted = typed.trim() === '' ? null : Number(typed)
    if (wanted !== null && (Number.isNaN(wanted) || wanted < 0)) return
    if (wanted === item.stock_amount) return

    onAmount(wanted)
  }

  return (
    <span class="stock-amount">
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        aria-label={`How much ${item.name}, in ${item.unit}`}
        disabled={busy}
        value={typed}
        onInput={(entered) => setTyped(entered.currentTarget.value)}
        onBlur={save}
        onKeyDown={(pressed) => {
          if (pressed.key === 'Enter') {
            pressed.preventDefault()
            save()
          }
        }}
      />
      <span>{item.unit}</span>
    </span>
  )
}

const PlaceFields = ({
  what,
  places,
  held,
  busy,
  onChange,
}: {
  what: string
  places: readonly PantryPlace[]
  held: readonly Placing[]
  busy: boolean
  onChange: (places: Placing[]) => void
}) => {
  if (places.length === 0) return null

  const without = (placeId: string) => held.filter((one) => one.place_id !== placeId)

  const write = (placeId: string, spot: string) => {
    onChange([...without(placeId), { place_id: placeId, spot }])
  }

  return (
    <fieldset class="pantry-places">
      <legend>Where it lives</legend>

      {places.map((place) => {
        const there = held.find((one) => one.place_id === place.id)

        return (
          <p key={place.id} class="row">
            <label>
              <input
                type="checkbox"
                aria-label={`In the ${place.name}, for ${what}`}
                checked={there !== undefined}
                disabled={busy}
                onChange={(ticked) =>
                  ticked.currentTarget.checked ? write(place.id, '') : onChange(without(place.id))
                }
              />
              <span>{place.name}</span>
            </label>
            <input
              type="text"
              maxLength={MAX_SPOT}
              placeholder="Which box?"
              aria-label={`Which box in the ${place.name}, for ${what}`}
              disabled={busy}
              value={there?.spot ?? ''}
              onInput={(typed) => write(place.id, typed.currentTarget.value)}
            />
          </p>
        )
      })}
    </fieldset>
  )
}

const ItemFields = ({
  item,
  allergies,
  places,
  busy,
  onCancel,
  onSave,
}: {
  item: PantryItem
  allergies: readonly AllergyItem[]
  places: readonly PantryPlace[]
  busy: boolean
  onCancel: () => void
  onSave: (changes: PantryEdit) => void
}) => {
  const [held, setHeld] = useState({
    kind: item.kind,
    name: item.name,
    unit: item.unit,
    note: item.note,
    allergy_item_ids: item.allergies.map((tag) => tag.id),
    places: item.places.map((one) => ({ place_id: one.place_id, spot: one.spot })),
  })

  const tick = (id: string) =>
    setHeld((was) => ({
      ...was,
      allergy_item_ids: was.allergy_item_ids.includes(id)
        ? was.allergy_item_ids.filter((ticked) => ticked !== id)
        : [...was.allergy_item_ids, id],
    }))

  return (
    <div class="pantry-edit">
      <label class="field">
        <span>Name</span>
        <input
          type="text"
          maxLength={MAX_OPTION_LABEL}
          aria-label={`Name, for ${item.name}`}
          value={held.name}
          onInput={(typed) => setHeld((was) => ({ ...was, name: typed.currentTarget.value }))}
        />
      </label>

      <label class="field">
        <span>Kind</span>
        <select
          aria-label={`Kind, for ${item.name}`}
          value={held.kind}
          onChange={(chosen) => {
            const kind = chosen.currentTarget.value
            if (isPantryKind(kind)) setHeld((was) => ({ ...was, kind }))
          }}
        >
          {pantryKinds.map((kind) => (
            <option key={kind} value={kind}>
              {pantryKindLabel[kind]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Counted in</span>
        <input
          type="text"
          maxLength={MAX_UNIT}
          aria-label={`Counted in, for ${item.name}`}
          value={held.unit}
          onInput={(typed) => setHeld((was) => ({ ...was, unit: typed.currentTarget.value }))}
        />
      </label>

      <label class="field">
        <span>Note</span>
        <input
          type="text"
          maxLength={MAX_PANTRY_NOTE}
          aria-label={`Note, for ${item.name}`}
          value={held.note}
          onInput={(typed) => setHeld((was) => ({ ...was, note: typed.currentTarget.value }))}
        />
      </label>

      <p class="form-note">{NOTE_IS_FOR}</p>

      <PlaceFields
        what={item.name}
        places={places}
        held={held.places}
        busy={busy}
        onChange={(wanted) => setHeld((was) => ({ ...was, places: wanted }))}
      />

      {allergies.length > 0 && (
        <p class="chip-row" role="group" aria-label={`What ${item.name} contains`}>
          {allergies.map((one) => (
            <button
              key={one.id}
              type="button"
              class={held.allergy_item_ids.includes(one.id) ? 'chip is-on' : 'chip'}
              aria-pressed={held.allergy_item_ids.includes(one.id)}
              disabled={busy}
              onClick={() => tick(one.id)}
            >
              {one.label}
            </button>
          ))}
        </p>
      )}

      <p class="row">
        <PendingButton
          busy={busy}
          label="Save"
          busyLabel="Saving…"
          type="button"
          onClick={() =>
            onSave({
              kind: held.kind,
              name: held.name.trim(),
              unit: held.unit.trim(),
              note: held.note.trim(),
              allergy_item_ids: held.allergy_item_ids,
              places: held.places.map((one) => ({ place_id: one.place_id, spot: one.spot.trim() })),
            })
          }
        />
        <button type="button" class="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  )
}
