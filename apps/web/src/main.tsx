import { render } from 'preact'

import { App } from './app.tsx'
import './styles.css'

const root = document.getElementById('app')

if (root === null) {
  throw new Error('No #app element to mount into — index.html and main.tsx disagree.')
}

render(<App />, root)
