import type { EventPantryItem, ShoppingSections } from '@sage-burner/shared'

import { haveSaid, shoppingSections, shoppingText, wantedSaid } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { useSelectedBurn } from '../burn.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { NAMELESS } from '../components/PersonBadge.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { localMoment } from '../datetime.ts'
import { useAction, useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type ShoppingApi = Pick<ApiClient, 'getEventPantry' | 'markPantryBought' | 'unmarkPantryBought'>

type Tick = (itemId: string, bought: boolean) => void

const boughtBy = (item: EventPantryItem): string => {
  if (item.bought === null) return ''

  const who = item.bought.by === null ? 'somebody who has left' : (item.bought.by_name ?? NAMELESS)

  return `${who} · ${localMoment(item.bought.at)}`
}

export const Shopping = ({ api }: { api: ShoppingApi }) => {
  const viewer = useViewer()
  const burn = useSelectedBurn()

  const { loaded, refreshing, reload } = useLoad(
    async (signal) => {
      if (burn === undefined) return { items: [] }

      return await api.getEventPantry(burn.event.id, signal)
    },
    {
      enabled: isApproved(viewer),
      key: burn?.event.id ?? '',
      fallback: 'Could not load the shopping list.',
      live: true,
      remember: 'shopping',
    },
  )

  const { busy, error, run } = useAction(reload)

  const sections = shoppingSections(loaded.status === 'ready' ? loaded.data.items : [])

  const tick: Tick = (itemId, bought) => {
    if (burn === undefined) return

    run(
      () =>
        bought ? api.markPantryBought(burn.event.id, itemId) : api.unmarkPantryBought(burn.event.id, itemId),
      'Could not save that.',
    )
  }

  return (
    <GuardedPage title="Shopping list" require="approved">
      <h1>
        Shopping list <Refreshing on={refreshing} />
      </h1>

      <p class="form-note">
        What people have asked for, with what the pantry says is already in the house beside it. How much of
        each to buy is not worked out here yet — that comes with the meals’ ingredients.
      </p>

      <ErrorText message={error} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && burn === undefined && <NoBurn absent="there is nothing to shop for" />}

      {loaded.status === 'ready' && burn !== undefined && (
        <List sections={sections} busy={busy} onTick={tick} />
      )}
    </GuardedPage>
  )
}

const List = ({
  sections,
  busy,
  onTick,
}: {
  sections: ShoppingSections<EventPantryItem>
  busy: boolean
  onTick: Tick
}) => {
  const [showingEnough, setShowingEnough] = useState(false)

  return (
    <>
      <p class="row">
        <CopyButton value={shoppingText(sections)} label="Copy as text" />
      </p>

      <section>
        <h2>Wanted</h2>

        {sections.wanted.length === 0 ? (
          <p class="form-note">
            Nothing is waiting to be bought. Hearts on the Meals and Pantry pages fill this list.
          </p>
        ) : (
          <Rows items={sections.wanted} bought={false} busy={busy} onTick={onTick} />
        )}

        {sections.enough.length > 0 && (
          <p>
            <button
              type="button"
              class="link-button"
              aria-expanded={showingEnough}
              onClick={() => setShowingEnough(!showingEnough)}
            >
              {showingEnough ? 'Hide' : 'Show'} the {sections.enough.length} thing
              {sections.enough.length === 1 ? '' : 's'} there is enough of
            </button>
          </p>
        )}

        {showingEnough && <Rows items={sections.enough} bought={false} busy={busy} onTick={onTick} />}
      </section>

      {sections.bought.length > 0 && (
        <section>
          <h2>Bought</h2>
          <Rows items={sections.bought} bought busy={busy} onTick={onTick} />
        </section>
      )}
    </>
  )
}

const Rows = ({
  items,
  bought,
  busy,
  onTick,
}: {
  items: readonly EventPantryItem[]
  bought: boolean
  busy: boolean
  onTick: Tick
}) => (
  <ul class="shopping-list">
    {items.map((item) => (
      <li key={item.id}>
        <label class={bought ? 'shopping-row is-bought' : 'shopping-row'}>
          <input
            type="checkbox"
            class="shopping-tick"
            checked={bought}
            disabled={busy}
            aria-label={`Bought ${item.name}`}
            onChange={(ticked) => onTick(item.id, ticked.currentTarget.checked)}
          />
          <span class="shopping-what">
            <span class="shopping-name">{item.name}</span>
            <span class="form-note">
              {[
                `♥ ${wantedSaid(item.hearts.count)}`,
                haveSaid(item),
                ...(item.where === '' ? [] : [item.where]),
              ].join(' · ')}
            </span>
            {bought && <span class="form-note">{boughtBy(item)}</span>}
          </span>
        </label>
      </li>
    ))}
  </ul>
)
