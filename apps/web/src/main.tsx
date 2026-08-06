import { render } from 'preact'

import { App } from './app.tsx'
import { registerServiceWorker } from './offline.ts'
import './styles.css'

const root = document.getElementById('app')

if (root === null) {
  throw new Error('No #app element to mount into — index.html and main.tsx disagree.')
}

// Here rather than inside `App`, which the test suite mounts: registering a worker is
// a property of the real page, and an effect doing it would run in every test.
registerServiceWorker()

render(<App />, root)
