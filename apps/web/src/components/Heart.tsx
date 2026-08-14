export const Heart = ({
  what,
  hearted,
  count,
  busy,
  onHeart,
}: {
  what: string
  hearted: boolean
  count: number
  busy: boolean
  onHeart: (hearting: boolean) => void
}) => (
  <button
    type="button"
    class="dream-heart"
    disabled={busy}
    aria-pressed={hearted}
    aria-label={`${hearted ? 'Take back your heart for' : 'Give a heart to'} ${what}`}
    onClick={(clickEvent) => {
      clickEvent.stopPropagation()
      onHeart(!hearted)
    }}
  >
    <span aria-hidden="true">{hearted ? '❤️‍🔥' : '♡'}</span>
    {count > 0 && <span class="dream-heart-count">{count}</span>}
  </button>
)
