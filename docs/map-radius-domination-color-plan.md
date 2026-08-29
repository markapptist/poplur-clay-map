# Map radius domination colour plan

## Goal

Make ownership, overlap, and the currently dominant radius readable at every
Map zoom without replacing Poplur's existing clay map styling or adding a
continuous rendering workload.

## Visual language

- **My radius:** the user's selected Poplur takeover colour at full saturation.
- **Other owners:** one stable identity colour chosen deterministically from
  the existing eight takeover swatches. The same person keeps the same colour
  on territory, pins, labels, and the Conquer board.
- **Unclaimed ground:** keep the current neutral clay map palette.
- **Selected radius:** add a white-and-pink outer rim and a single short pop
  pulse; do not continuously animate it.
- **Contested overlap:** paint the current winner's colour and add a contrasting
  double/dashed rim plus a small contest badge. Do not blend two owner colours,
  because the result would no longer identify either owner reliably.
- **Pins:** use the owner's colour for the pin body/ring; add a crown or rank
  mark to the current winner. Mine also keeps the existing personal marker cue.

Colour is never the only signal: labels, rim patterns, rank/crown marks, and
accessible owner/radius text must communicate the same state.

## Zoom behaviour

1. **World and regional:** show simplified owner-colour patches and only the
   leading owners for the visible area. Suppress minor pin labels.
2. **City and neighbourhood:** soften the fill, strengthen territory rims, and
   show owner-coloured pins with radius and rank.
3. **Close pitched 3D:** keep landmarks independent. Tint only the existing
   capped set of camera-relevant buildings, plus the radius rim and pins, so
   domination remains dimensional without increasing the thermal budget.

## Data and conflict rules

- Assign an owner colour once from the stable owner ID; persist a user's chosen
  takeover colour when available.
- Because the eight identity hues can collide, adjacent territories owned by
  different people with the same preferred swatch receive deterministic,
  contrasting rim/pattern tokens. The owner's identity hue remains stable
  everywhere; only the adjacency cue changes.
- Default to the existing fame-first `dominancePower` ordering so the Map and
  Conquer board keep one definition of the winner. Radius controls the physical
  area held; fame controls who wins an overlap. Label this as **domination
  power**, not “largest radius.” If product intent is instead literal
  radius-first ownership, change the one shared comparator before any visual
  work, then reuse it for ground, buildings, pins, and Conquer ranking.
- The strongest overlapping claim owns the fill, with deterministic ID
  tie-breaking so colours never flicker.
- Carry `ownerId`, colour token, rank, radius, and contested state through the
  existing claim/pin snapshot rather than deriving them independently in UI.
- Keep the Conquer preview and full board on the same colour tokens as the Map.

## Performance rules

- Repaint ownership only after a claim change or a settled camera move.
- Never recompute colours during pan/zoom frames.
- Reuse current pin, claim, and close-building culling limits.
- Prefer Mapbox expressions and stable feature IDs over per-frame DOM updates.
- Preserve the existing idle snapshot/thermal governor and reduced-motion path.

## Ranked ownership and compounding economy

Every coordinate that receives posts keeps a deterministic owner ranking rather
than a single unqualified flag. Domination power establishes the order; the
incumbent wins an exact tie so the deed cannot flicker between refreshes.

1. **Rank #1 owns the coordinate.** Their videos receive a `3x` local feed
   weight while a verified person is inside the space. Rank #2 receives `1.8x`
   and rank #3 receives `1.2x`, so challengers are discoverable but the owner
   has the strongest advantage.
2. **Qualified foot traffic pays the owner.** One unique, non-self, verified
   walk-in adds one ownership Credit to rank #1, subject to a daily cap.
3. **Posting compounds ownership Radius.** When an eligible third party posts
   inside the coordinate, rank #1 earns `+0.08 km`, rank #2 earns `+0.03 km`,
   and rank #3 earns `+0.01 km` of Radius. This deliberately creates the
   “richer get richer” loop: active territory attracts people and posts, and
   that activity strengthens the owners already dominating it.
4. **Credits style the visible property.** Owners can license and equip Poplur,
   candy, nightclub, or holiday building themes. Themes change materials and
   roof caps while retaining owner-colour walls; spending does not directly
   rewrite the rank.
5. **Upkeep grows the property.** Eligible local activity advances Plot,
   Kiosk, Venue, and Tower presentation levels. Missed upkeep first fades the
   deed, then returns it to neutral so dormant owners do not hold the map
   forever.

The working preview uses deliberately bounded demo Credits and Radius. A live
version must record visits, posts, owner ranks, Radius dividends, and Credit
payouts in one idempotent server transaction. It must reject self-traffic,
duplicate devices/accounts, impossible movement, deleted or moderated posts,
and replayed event IDs; it must also enforce per-coordinate and daily caps.
The public Map continues to expose a coarse territory cell, never a person's
exact selected point.

## Delivery phases

1. Add typed domination colour tokens and deterministic owner-colour tests.
2. Apply the tokens to territory fills/rims, pins, labels, and Conquer rows.
3. Add contested/selected patterns and a small Map legend/filter.
4. Verify colour contrast, colour-blind readability, deterministic overlap,
   zoom transitions, capped 3D buildings, and a sustained connected-iPhone
   Map thermal soak before release.
