import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';

const shippingRoot = new URL('../../public/subscreens/', import.meta.url);
const artifactRoot = new URL('../../../.claude/artifacts/', import.meta.url);
const sources = [
  ['shipping', shippingRoot],
  ['artifact', artifactRoot],
];

const catalog = [
  ['com.apptist.Poplur2025.card.inverted', '$2.99', 300, 'poplur_card_inverted.glb'],
  ['com.apptist.Poplur2025.card.lens', '$4.99', 550, 'poplur_card_lens.glb'],
  ['com.apptist.Poplur2025.card.splitdiamond', '$6.99', 800, 'poplur_card_split_diamond.glb'],
  ['com.apptist.Poplur2025.card.swoosh', '$9.99', 1200, 'poplur_card_swoosh.glb'],
];

for (const [label, root] of sources) {
  const js = await readFile(new URL('poplur-subscreen-twins.js', root), 'utf8');
  const htmlName = label === 'shipping' ? 'index.html' : 'poplur-subscreen-twins.html';
  const html = await readFile(new URL(htmlName, root), 'utf8');

  for (const [productId, price, credits, model] of catalog) {
    assert.match(js, new RegExp(productId.replaceAll('.', '\\.') + "'"), `${label}: ${productId}`);
    assert.ok(js.includes(`price: '${price}'`), `${label}: ${price}`);
    assert.match(js, new RegExp(`credits: ${credits}\\b`), `${label}: ${credits} credits`);
    const modelUrl = new URL(`store-models/${model}`, root);
    await access(modelUrl);
    const modelStat = await stat(modelUrl);
    assert.ok(modelStat.size > 100_000 && modelStat.size < 4_000_000, `${label}: optimized ${model}`);
    const poster = model.replace('.glb', '.jpg');
    assert.ok(js.includes(`poster: \`${'${STORE_POSTERS}'}${poster}\``), `${label}: ${poster} catalog poster`);
    const posterUrl = new URL(`store-posters/${poster}`, root);
    await access(posterUrl);
    const posterStat = await stat(posterUrl);
    assert.ok(posterStat.size > 10_000 && posterStat.size < 150_000, `${label}: lightweight ${poster}`);
  }

  assert.match(js, /setInterval\(\(\) => setStoreSlide\(profileStoreSlide \+ 1\), 3000\)/, `${label}: exact 3-second cadence`);
  assert.match(js, /type: 'poplurStoreCheckoutRequested'/, `${label}: checkout request bridge`);
  assert.match(js, /cardId: line\.product\.id/, `${label}: stable cross-platform card ID`);
  assert.match(js, /iosProductId: line\.product\.iosProductId/, `${label}: explicit iOS product ID`);
  assert.match(js, /androidProductId: line\.product\.androidProductId/, `${label}: explicit Android product ID`);
  assert.match(js, /data\.type !== 'poplurStoreCheckoutResult'/, `${label}: checkout result bridge`);
  assert.match(js, /window\.parent !== window && event\.source !== window\.parent/, `${label}: checkout results come from the parent host`);
  assert.match(js, /removeCompletedStoreItems\(data\.completedItems\)/, `${label}: partial checkout reconciliation`);
  assert.match(js, /profileStoreCheckoutSnapshot = lines\.map/, `${label}: immutable request snapshot`);
  assert.match(js, /!profileStoreCheckoutPending \|\| typeof profileStoreCheckoutRequestId !== 'string'/, `${label}: results require an active checkout`);
  assert.match(js, /typeof data\.requestId !== 'string' \|\| data\.requestId !== profileStoreCheckoutRequestId/, `${label}: request matching fails closed`);
  assert.match(js, /if \(status === 'pending'\)[\s\S]{0,500}bag stays locked/, `${label}: pending keeps the bag locked`);
  assert.doesNotMatch(js, /if \(status === 'success'\) \{\s*profileStoreBag = \[\]/, `${label}: success reconciles only verified quantities`);
  assert.match(js, /function storeBagMutationIsLocked\(\)/, `${label}: bag mutation lock`);
  assert.doesNotMatch(js, /profileCartCount|test checkout|test cart/, `${label}: no counter-only/fake cart`);
  assert.match(html, /<script type="module" src="\.\/vendor\/model-viewer\.min\.js"><\/script>/, `${label}: local model-viewer`);
  await access(new URL('vendor/model-viewer.min.js', root));
}

const homeTwin = await readFile(new URL('../../src/HomeTwin.tsx', import.meta.url), 'utf8');
const holdMenuTwin = await readFile(new URL('../../src/HoldMenuTwin.tsx', import.meta.url), 'utf8');

assert.match(homeTwin, /detail\?\.type !== 'poplurStoreCheckoutRequested'/, 'Home validates the exact checkout request type');
assert.match(homeTwin, /IOS_STORE_PRODUCT_BY_CARD_ID\[cardId\] === iosProductId/, 'Home validates iOS product mappings');
assert.match(homeTwin, /ANDROID_STORE_PRODUCT_BY_CARD_ID\[cardId\] === androidProductId/, 'Home validates Android product mappings');
assert.match(homeTwin, /Number\.isInteger\(quantity\)[\s\S]{0,180}quantity <= 10/, 'Home bounds line quantities');
assert.match(homeTwin, /validatedItems\.push\(\{ cardId, iosProductId, androidProductId, quantity \}\)/, 'Home allowlists native item fields');
assert.match(homeTwin, /const nativeRequest = \{[\s\S]{0,180}type: 'poplurStoreCheckoutRequested',[\s\S]{0,180}requestId,[\s\S]{0,180}items: validatedItems,[\s\S]{0,80}\}/, 'Home constructs a sanitized native request');
assert.match(homeTwin, /!isNativeShell\(\) \|\| !postNativeEvent\(nativeRequest\)/, 'Home forwards only the sanitized checkout to a native shell');
assert.match(homeTwin, /data\.type !== 'poplurStoreCheckoutResult'/, 'Home accepts the exact native result type');
assert.match(homeTwin, /activeStoreCheckoutRequestRef\.current = requestId/, 'Home tracks the one native checkout in flight');
assert.match(homeTwin, /data\.requestId !== activeStoreCheckoutRequestRef\.current/, 'Home rejects stale native checkout results');
assert.match(homeTwin, /if \(status !== 'pending'\) activeStoreCheckoutRequestRef\.current = null/, 'Home retains pending request ownership until a final result');
assert.match(homeTwin, /new CustomEvent\('poplur-store-checkout-result'/, 'Home emits results for the Store relay');

assert.match(holdMenuTwin, /event\.source === frame\.contentWindow && data\.type === 'poplurStoreCheckoutRequested'/, 'Hold Menu source-validates Store requests');
assert.match(holdMenuTwin, /new CustomEvent\('poplur-store-checkout-requested'/, 'Hold Menu relays requests to Home');
assert.match(holdMenuTwin, /data\?\.type === 'poplurStoreCheckoutResult'/, 'Hold Menu filters the exact result type');
assert.match(holdMenuTwin, /frame\.contentWindow\?\.postMessage\(data, '\*'\)/, 'Hold Menu routes native results into the Store iframe');

console.log('Store contract verified for shipping and artifact sources.');
