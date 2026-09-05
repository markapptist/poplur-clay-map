// The three BUSINESS testers' profile documents, written over the Firestore
// REST API with the workstation's ADC token — the same route every seed here
// takes. This is the Firestore HALF of what
// Poplur2025-iOS/functions/scripts/provisionSyntheticBetaAccounts.js does; the
// other half (the Auth accounts, their claims and the runner allowlist) needs
// the Auth admin API and is run by the owner. Provisioning MERGES the same
// shape over these documents, so running both in either order is safe.
//
// Two documents make an account a business:
//   users/{uid}       accountType "business" — the role native clients and the
//                     Meshy gate read; owner-only per the rules.
//   businesses/{uid}  keyed ownerUserId — world-readable, and the ONLY way a
//                     peer (feed byline, visited profile, mail roster) learns
//                     that a poster is a business. Same keys as the iOS
//                     BusinessProfile.toDictionary().
// Every field here mirrors provisionSyntheticBetaAccounts.js; change both.
import { execFileSync } from 'node:child_process'
const FS = 'https://firestore.googleapis.com/v1/projects/poplur2025/databases/(default)/documents'
const COHORT_ID = 'beta-browser-v1'
const SOURCE = 'synthetic-browser'

const BUSINESSES = [
  {
    actorId: 'sim-biz-food-006', email: 'beta-sim-biz-food-006@poplur.test', handle: 'nightmarket', pinColor: 'orange',
    name: 'Night Market Eats', category: 'Restaurant',
    description: 'Late-night street food stall. Synthetic beta tester — not a real business.',
    address: 'Kensington Market, Toronto, ON', place: 'Toronto', latitude: 43.6545, longitude: -79.4005,
  },
  {
    actorId: 'sim-biz-shop-007', email: 'beta-sim-biz-shop-007@poplur.test', handle: 'hauls.to', pinColor: 'purple',
    name: 'Hauls Outlet', category: 'Retail',
    description: 'Discount fashion and homeware outlet. Synthetic beta tester — not a real business.',
    address: 'Eaton Centre, Toronto, ON', place: 'Toronto', latitude: 43.6544, longitude: -79.3807,
  },
  {
    actorId: 'sim-biz-fashion-008', email: 'beta-sim-biz-fashion-008@poplur.test', handle: 'fitcheck.nyc', pinColor: 'blue',
    name: 'Fit Check Daily', category: 'Boutique',
    description: 'SoHo boutique posting daily fits. Synthetic beta tester — not a real business.',
    address: 'SoHo, New York, NY', place: 'New York', latitude: 40.7233, longitude: -74.003,
  },
]

const s = value => ({ stringValue: value })
const b = value => ({ booleanValue: value })
const d = value => ({ doubleValue: value })
const now = new Date().toISOString()

function profileFields(biz) {
  return {
    businessName: s(biz.name),
    businessCategory: s(biz.category),
    businessDescription: s(biz.description),
    businessAddress: s(biz.address),
    latitude: d(biz.latitude),
    longitude: d(biz.longitude),
    location: { geoPointValue: { latitude: biz.latitude, longitude: biz.longitude } },
    contactEmail: s(biz.email),
    contactPhone: s(''),
    website: s(''),
    logoPhotoNotes: s(''),
    verificationStatus: s('verified'),
    verificationStatusLabel: s('Verified'),
    verificationMethods: { arrayValue: { values: [] } },
    verificationMethodLabels: { arrayValue: { values: [] } },
    proofSummary: s('Provisioned synthetic beta business — not a real business.'),
    requiresReverification: b(false),
    mapVisibility: b(true),
    markerType: s('verified_business_profile'),
  }
}

function cohortTags(biz) {
  return {
    syntheticBeta: b(true),
    syntheticActorId: s(biz.actorId),
    cohortId: s(COHORT_ID),
    source: s(SOURCE),
    updatedAt: { timestampValue: now },
  }
}

const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function merge(path, fields) {
  const mask = Object.keys(fields).map(key => `updateMask.fieldPaths=${key}`).join('&')
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) })
  const body = await r.json()
  if (!r.ok) { console.error(`FAILED ${path}:`, body.error?.message); process.exit(1) }
  return body
}

async function exists(path) {
  const r = await fetch(`${FS}/${path}?mask.fieldPaths=createdAt`, { headers })
  return r.status === 200
}

for (const biz of BUSINESSES) {
  const profile = profileFields(biz)
  const userPath = `users/${biz.actorId}`
  const businessPath = `businesses/${biz.actorId}`
  const [userExisted, businessExisted] = await Promise.all([exists(userPath), exists(businessPath)])
  await merge(userPath, {
    uid: s(biz.actorId),
    email: s(biz.email),
    username: s(biz.handle),
    usernameNormalized: s(biz.handle.toLowerCase()),
    displayName: s(biz.name),
    accountType: s('business'),
    isBusinessAccount: b(true),
    isVerifiedBusiness: b(true),
    businessName: s(biz.name),
    businessCategory: s(biz.category),
    businessAddress: s(biz.address),
    businessLocation: profile.location,
    businessProfile: { mapValue: { fields: profile } },
    pinColor: s(biz.pinColor),
    ...cohortTags(biz),
    ...(userExisted ? {} : { createdAt: { timestampValue: now } }),
  })
  await merge(businessPath, {
    ownerUserId: s(biz.actorId),
    ownerUserID: s(biz.actorId),
    email: s(biz.email),
    accountType: s('business'),
    handle: s(biz.handle),
    place: s(biz.place),
    ...profile,
    ...cohortTags(biz),
    ...(businessExisted ? {} : { submittedAt: { timestampValue: now }, createdAt: { timestampValue: now } }),
  })
  console.log(`${userExisted ? 'updated' : 'created'} ${userPath} · ${businessExisted ? 'updated' : 'created'} ${businessPath}  (${biz.name}, @${biz.handle})`)
}
console.log(`\n${BUSINESSES.length} business testers listed. Auth accounts + runner allowlist still come from provisionSyntheticBetaAccounts.js.`)
