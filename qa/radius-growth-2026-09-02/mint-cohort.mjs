// Phase 2 cohort: five permanent synthetic actor accounts, minted once and
// reused by every future radius test. Emails carry the entropy and passwords
// derive from the email (same convention as the shared-journey accounts), so
// no secret file exists. A rerun with .cohort.json present verifies sign-in
// for each stored account and mints nothing.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
const API_KEY = 'AIzaSyDbDM14RX9pIBk4NB-paCArt_7UZBt6OYM'
const COHORT_SIZE = 5
const cohortPath = new URL('./.cohort.json', import.meta.url).pathname
export const passwordForActor = email => {
  const [, n, entropy] = email.match(/^radius\.actor\.(\d+)-([a-z0-9]+)@/)
  return `Poplur!Radius-${n}-${entropy}-9z`
}
const idty = (endpoint, body) => fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
).then(r => r.json())

if (existsSync(cohortPath)) {
  const emails = JSON.parse(readFileSync(cohortPath, 'utf8'))
  let ok = 0
  for (const email of emails) {
    const r = await idty('signInWithPassword', { email, password: passwordForActor(email), returnSecureToken: true })
    if (r.idToken) ok += 1
    else console.error(`sign-in FAILED for ${email}: ${r.error?.message}`)
  }
  console.log(`cohort exists: ${ok}/${emails.length} accounts sign in — nothing minted`)
  process.exit(ok === emails.length ? 0 : 1)
}

const emails = []
for (let n = 1; n <= COHORT_SIZE; n += 1) {
  const entropy = Math.random().toString(36).slice(2, 10)
  const email = `radius.actor.${n}-${entropy}@synthetic.poplur.test`
  const r = await idty('signUp', { email, password: passwordForActor(email), returnSecureToken: true })
  if (!r.localId) { console.error(`mint FAILED for ${email}: ${r.error?.message}`); process.exit(1) }
  emails.push(email)
  appendFileSync(new URL('./manifest.md', import.meta.url).pathname,
    `- ${new Date().toISOString()} minted cohort Auth account ${email} (uid ${r.localId}); no users doc, no storage residue.\n`)
  console.log(`minted ${email} (${r.localId})`)
}
writeFileSync(cohortPath, JSON.stringify(emails, null, 2) + '\n')
console.log(`\ncohort of ${emails.length} saved to .cohort.json`)
