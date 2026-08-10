import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { LocationProvider, Route, Router } from 'preact-iso'
import { afterEach, describe, expect, it } from 'vitest'

import { ROUTER_SCOPE } from './router-scope.ts'

afterEach(cleanup)

/**
 * What the router does with a click, which is the half no `href` assertion can see (#422).
 *
 * `WaysInField` and `Login` both had the right `href` and both rendered "Nothing here" when
 * somebody clicked it: `LocationProvider` claimed the navigation, no route matched, and the
 * redirect to the provider never happened.
 */

const Start = () => (
  <>
    <a href={apiRoutes.startOauthLink.path('facebook')}>Link it</a>
    <a href="/members">Members</a>
  </>
)

/** Stops happy-dom trying to navigate for real. Registered after the provider's, so it cannot
    stop the routing this is testing. */
const swallow = (event: Event) => event.preventDefault()

const show = () => {
  const shown = render(
    <LocationProvider scope={ROUTER_SCOPE}>
      <Router>
        <Route path="/" component={Start} />
        <Route path="/members" component={() => <p>The members page</p>} />
        <Route default component={() => <p>Nothing here</p>} />
      </Router>
    </LocationProvider>,
  )
  addEventListener('click', swallow)

  return shown
}

afterEach(() => {
  removeEventListener('click', swallow)
  // `app.test.tsx` does the same. Without it the second case below leaves history at
  // `/members`, and a third one added later would start from there rather than from `/`.
  window.history.replaceState(null, '', '/')
})

describe('clicking a link the backend serves', () => {
  it('is left to the browser rather than routed to Nothing here', async () => {
    show()

    fireEvent.click(await screen.findByText('Link it'))

    expect(screen.queryByText('Nothing here')).toBeNull()
    // Still on the page it was clicked from, which is what "the browser has it" looks like
    // from in here: nothing rendered, nothing unmounted.
    expect(screen.getByText('Link it')).toBeTruthy()
  })

  it('still routes a link to a page, which is the whole point of the router', async () => {
    // The passing sibling. A scope that matched nothing would satisfy the case above and turn
    // every link in the app into a full page load.
    show()

    fireEvent.click(await screen.findByText('Members'))

    expect(await screen.findByText('The members page')).toBeTruthy()
  })
})
