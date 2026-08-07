#!/usr/bin/env node
/**
 * Seed a burn's FAQ from a JSON file of `{ question, answer }` entries.
 *
 * Written for the one-off import of the old spreadsheet's Q&A tab, but it takes any
 * such file. It signs in with a password, picks the burn, and posts the entries in
 * order — the API assigns `order` by arrival, so the file's order is the page's.
 *
 * The credential comes from the environment and is never written anywhere:
 *
 *   SAGE_EMAIL=you@example.com SAGE_PASSWORD='…' \
 *     node scripts/import-faq.mjs https://sage.hokasgard.se entries.json
 *
 * Add `--dry-run` to see what it would post and what is already there.
 */

const [, , origin, file, ...flags] = process.argv
const dryRun = flags.includes('--dry-run')

if (origin === undefined || file === undefined) {
  console.error('❌ usage: import-faq.mjs <origin> <entries.json> [--dry-run]')
  process.exit(1)
}

const email = process.env.SAGE_EMAIL
const password = process.env.SAGE_PASSWORD
const given = process.env.SAGE_COOKIE

if (given === undefined && (email === undefined || password === undefined)) {
  console.error('❌ set SAGE_COOKIE, or SAGE_EMAIL and SAGE_PASSWORD')
  process.exit(1)
}

const entries = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'))
if (!Array.isArray(entries) || entries.some((one) => typeof one?.question !== 'string')) {
  console.error('❌ the file must be an array of { question, answer }')
  process.exit(1)
}

let cookie = given ?? ''

const call = async (method, path, body) => {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const set = response.headers.getSetCookie?.() ?? []
  if (set.length > 0) cookie = set.map((one) => one.split(';')[0]).join('; ')

  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`)

  return text === '' ? undefined : JSON.parse(text)
}

if (given === undefined) {
  console.log(`🔑 signing in to ${origin} as ${email}`)
  await call('POST', '/api/auth/login', { email, password })
}

const { viewer } = await call('GET', '/api/auth/me')
if (viewer === null) {
  console.error('❌ not signed in — the cookie may have expired')
  process.exit(1)
}
console.log(`🔑 ${origin} as ${viewer.name ?? viewer.account_id} (${viewer.roles.join(', ')})`)

// `coming` is every burn that has not ended, which is exactly what the FAQ's
// writes are scoped to.
const { coming } = await call('GET', '/api/events/mine')

if (coming.length === 0) {
  console.error('❌ no open burn to write to — the FAQ is per burn, and a finished one is read-only')
  process.exit(1)
}

const burn = coming[0]
if (coming.length > 1) console.log(`⚠️  ${coming.length} open burns; using the soonest, ${burn.event.name}`)

console.log(`🔥 ${burn.event.name} (${burn.event.start_date} → ${burn.event.end_date})`)

const { entries: existing } = await call('GET', `/api/events/${encodeURIComponent(burn.event.id)}/faq`)
console.log(`📖 ${existing.length} question(s) already there`)

const asked = new Set(existing.map((one) => one.question.trim().toLowerCase()))
const wanted = entries.filter((one) => !asked.has(one.question.trim().toLowerCase()))

if (wanted.length < entries.length) {
  console.log(`⏭️  skipping ${entries.length - wanted.length} already asked`)
}

if (dryRun) {
  for (const one of wanted) console.log(`   • ${one.question}`)
  console.log(`\n🧪 dry run — nothing written. ${wanted.length} would be added.`)
  process.exit(0)
}

for (const one of wanted) {
  await call('POST', `/api/events/${encodeURIComponent(burn.event.id)}/faq`, {
    question: one.question,
    answer: one.answer ?? '',
  })
  console.log(`   ✅ ${one.question}`)
}

console.log(`\n🎉 ${wanted.length} question(s) added. Have a look at ${origin}/faq`)
