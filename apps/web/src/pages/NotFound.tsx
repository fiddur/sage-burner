/**
 * Client-side 404.
 *
 * The backend serves the app shell for any extensionless path it does not
 * recognise, so an unknown route lands here rather than on a server error page.
 */
export const NotFound = () => (
  <article class="prose">
    <h1>Nothing here</h1>
    <p>That page does not exist yet, or the link that brought you here has stopped working.</p>
    <p>
      If you were following an invite, ask whoever sent it for a fresh one — invites are single-use and do
      expire.
    </p>
    <p>
      <a class="button" href="/">
        Back to the start
      </a>
    </p>
  </article>
)
