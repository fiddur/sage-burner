import { render } from 'preact'

import { App } from './app.tsx'
import { watchInstalls } from './install.ts'
import { registerServiceWorker } from './offline.ts'
import './styles.css'

const root = document.getElementById('app')

if (root === null) {
  throw new Error('No #app element to mount into — index.html and main.tsx disagree.')
}

// Here rather than inside `App`, which the test suite mounts: registering a worker is
// a property of the real page, and an effect doing it would run in every test.
registerServiceWorker()

// Before the first render, not in an effect — `InstallWatch` says why (#281). Built
// here for the same reason `createRemembered` is built in `App`: a module holding it
// would be shared by two suites in one process.
render(<App installs={watchInstalls()} />, root)
