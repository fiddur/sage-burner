/**
 * Public landing page.
 *
 * A placeholder until #13, which renders the active event's admin-authored
 * welcome markdown here. Deliberately not inventing copy that an organiser will
 * only have to delete.
 */
export const Home = () => (
  <article class="prose">
    <h1>Sage Burner</h1>
    <p>
      Membership, applications and the shared programme for a small co-created gathering — the things that
      used to live in a spreadsheet.
    </p>
    <p class="notice">
      This is the skeleton. The welcome text an organiser writes for each burn will appear here.
    </p>
    <p>
      <a class="button" href="/apply">
        Apply to join
      </a>
    </p>
  </article>
)
