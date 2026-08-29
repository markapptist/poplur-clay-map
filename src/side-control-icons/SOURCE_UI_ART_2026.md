# Poplur UI art extension

Source sheet SHA-256: `f7ffcec4e072c488c7b6f7c053bfb7aa7489005a5497b3bbf8adaff6324e5a3b`

The supplied 1536×1024 RGBA sheet already has transparency. Runtime artwork
was cropped without chroma-keying, fitted inside a transparent square, and
exported at 256 and 512 pixels. The 1024-pixel authoring copies remain under
`dev-assets` so native and production bundles do not carry gallery masters.

Source crop rectangles use `x:y:width:height`:

- pause: `19:561:284:280`
- volume: `310:558:302:284`
- radio: `619:543:294:299`
- TV: `917:535:297:307`
- location: `1218:544:297:302`

The sheet's larger cards and bottom status bars are references only. Their
sample channel, place, weather timing, radius, and progress text must never be
served as raster UI; Poplur renders those values from live application state.
