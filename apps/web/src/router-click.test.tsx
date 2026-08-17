import { apiRoutes } from '@sage-burner/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { LocationProvider, Route, Router } from 'preact-iso'
import { afterEach, describe, expect, it } from 'vitest'

import { ROUTER_SCOPE } from './router-scope.ts'

afterEach(cleanup)

const Start = () => (
  <>
    <a href={apiRoutes.startOauthLink.path('facebook')}>Link it</a>
    <a href="/members">Members</a>
  </>
)

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
  window.history.replaceState(null, '', '/')
})

describe('clicking a link the backend serves', () => {
  it('is left to the browser rather than routed to Nothing here', async () => {
    show()

    fireEvent.click(await screen.findByText('Link it'))

    expect(screen.queryByText('Nothing here')).toBeNull()
    expect(screen.getByText('Link it')).toBeTruthy()
  })

  it('still routes a link to a page, which is the whole point of the router', async () => {
    show()

    fireEvent.click(await screen.findByText('Members'))

    expect(await screen.findByText('The members page')).toBeTruthy()
  })
})
