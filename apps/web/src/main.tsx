import { render } from 'preact'

import { App } from './app.tsx'
import { watchInstalls } from './install.ts'
import { registerServiceWorker } from './offline.ts'
import './styles.css'

const root = document.getElementById('app')

if (root === null) {
  throw new Error('No #app element to mount into — index.html and main.tsx disagree.')
}

registerServiceWorker()

render(<App installs={watchInstalls()} />, root)
