import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const COOKIE = 'sage_session'

const tryoutDir = process.env.TRYOUT_DIR ?? '/tmp/tryout'
const statePath = join(tryoutDir, 'state.json')
const tokenPath = join(tryoutDir, 'token.txt')

const readState = () => {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (cause) {
    throw new Error(`cannot read ${statePath} — run tryouts/up.sh first`, { cause })
  }
}

const login = async ({ baseUrl, email, password }) => {
  const answer = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!answer.ok) {
    throw new Error(`login failed: ${answer.status} ${await answer.text()}`)
  }

  const cookies = answer.headers.getSetCookie()
  const raw = cookies.find((cookie) => cookie.startsWith(`${COOKIE}=`))
  if (raw === undefined) {
    throw new Error(`login carried no ${COOKIE} cookie (set-cookie: ${JSON.stringify(cookies)})`)
  }

  const token = raw.slice(COOKIE.length + 1).split(';')[0]
  if (token === undefined || token === '') throw new Error(`the ${COOKIE} cookie was empty`)
  return token
}

const viewerFor = async (baseUrl, token) => {
  const answer = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: `${COOKIE}=${token}` } })
  if (!answer.ok) throw new Error(`GET /api/auth/me failed: ${answer.status} ${await answer.text()}`)

  const { viewer } = await answer.json()
  if (viewer === null || viewer === undefined) {
    throw new Error('GET /api/auth/me named no viewer — the cookie did not authenticate')
  }
  return viewer
}

const state = readState()

console.info(`🔑 logging in as ${state.email} at ${state.baseUrl}`)
const token = await login(state)
const viewer = await viewerFor(state.baseUrl, token)
console.info(`✅ ${viewer.account_id} is signed in (roles: ${viewer.roles.join(', ') || 'none'})`)

const next = {
  ...state,
  cookieName: COOKIE,
  token,
  account: { id: viewer.account_id, email: state.email, roles: viewer.roles },
}
writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`)
chmodSync(statePath, 0o600)
writeFileSync(tokenPath, token)
chmodSync(tokenPath, 0o600)

console.info(`💾 wrote ${statePath} and ${tokenPath}`)
