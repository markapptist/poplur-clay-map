# Poplur Clay Map

Interactive Mapbox GL JS prototype of the Poplur clay map: a hand-molded clay
world with stitched pink roads, true-to-life cream clay buildings, popping
landmarks, weather, day/night sky, and the provided 3D clay assets (car,
plane, boat, palm, cube) living on the map.

## Run

```bash
npm install
cp .env.example .env   # paste your Mapbox public token
npm run dev            # http://localhost:5173
```

## Console demos (dev build)

| Command | What it does |
| --- | --- |
| `__setWeather('rain' \| 'storm' \| 'snow' \| 'cloudy' \| 'fog' \| 'clear')` | force a weather overlay |
| `__setWeather(null)` | back to live open-meteo weather |
| `__setSky(true/false)` | day / night sky |
| `__startTour(4)` | cinematic tour across random landmarks |
| `__triggerPops()` | pop a building (street zoom) |

## Structure

- `src/ClayMap.tsx` — the map: clay styling, 3D buildings, roads, landmarks,
  flyers, cars/boats/trees, pops, tour, themes, sky
- `src/modelSprite.ts` — renders the provided GLBs to marker sprites
- `src/WeatherFX.tsx` — rain / storm / snow / cloudy / fog overlays
- `src/data.ts` — palette, POIs, cube-skin map themes
- `public/models/*.glb` — provided Meshy clay models (Git LFS)

## Notes

- The globe uses Mapbox `projection: 'globe'`; zooming out morphs the city
  into the clay earth with landmarks, planes, satellites and clouds.
- Buildings are Mapbox extrusions with `fill-extrusion-edge-radius` + AO +
  cast shadows for the clay look, in Apple-Maps-neutral cream.
- For production, bake `modelSprite` outputs to static PNGs at build time
  instead of loading ~140 MB of GLBs per session.
