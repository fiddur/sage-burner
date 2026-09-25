import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const tryoutHome = () => process.env.TRYOUT_HOME ?? '/opt/tryout'
const tryoutDir = () => process.env.TRYOUT_DIR ?? '/tmp/tryout'

export const readState = () => JSON.parse(readFileSync(join(tryoutDir(), 'state.json'), 'utf8'))

const attempt = (thunk) => {
  try {
    return thunk()
  } catch {
    return undefined
  }
}

const loadPuppeteer = () => {
  const load = createRequire(join(tryoutHome(), 'package.json'))
  const found = attempt(() => load('puppeteer')) ?? attempt(() => load('puppeteer-core'))
  if (found === undefined) {
    throw new Error(`no puppeteer under ${tryoutHome()} — run tryouts/setup-environment.sh`)
  }
  return found
}

const chromePath = async (puppeteer) => {
  const asked = process.env.TRYOUT_CHROME
  if (asked !== undefined && asked !== '') return asked

  const marker = join(tryoutHome(), 'chrome-path')
  const recorded = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''
  if (recorded !== '') return recorded

  const bundled = await Promise.resolve(attempt(() => puppeteer.executablePath?.())).catch(() => undefined)
  if (typeof bundled === 'string' && bundled !== '') return bundled

  throw new Error('no Chrome to launch — set TRYOUT_CHROME or run tryouts/setup-environment.sh')
}

export const launchBrowser = async (options = {}) => {
  const puppeteer = loadPuppeteer()
  const { args = [], ...rest } = options
  return await puppeteer.launch({
    executablePath: await chromePath(puppeteer),
    args: [...args, '--no-sandbox'],
    ...rest,
  })
}

export const signedInPage = async (browser, state = readState()) => {
  const page = await browser.newPage()
  await page.setCookie({ name: state.cookieName, value: state.token, url: state.baseUrl, httpOnly: true })
  return page
}
