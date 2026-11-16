# Koke — a moss garden

An interactive simulation of moss colonising a stone (or a cedar trunk) in a Japanese forest.
The screen is the surface; press and drag to sow spores, mist, warm, or scrape it.

```
npm install
npm run dev      # develop
npm run build    # one self-contained dist/index.html
```

## How the moss grows

The model runs on the GPU as a cellular simulation over a baked height field
(`src/shaders/sim.js`). Each cell stores moss thickness, surface water, maturity
and hydration.

- **Water** condenses with humidity, runs downhill into fissures and hollows,
  spreads by capillarity and evaporates faster on sunlit, exposed faces. Moss
  cushions hold water like a sponge, so established moss makes the ground next
  to it more hospitable.
- **Colonisation** happens two ways: shoots creep into neighbouring cells as a
  stochastic front biased by habitat quality, and mature moss releases spores
  that establish at a distance through a heavy-tailed dispersal kernel.
- **Thickening** is logistic, with a carrying capacity set by moisture and
  shelter, so cushions swell in damp crevices and stay thin on open rock.
- **Colour** follows age and hydration. New growth is bright yellow-green,
  mature moss deepens to emerald and carries copper sporophytes. Moss is
  poikilohydric: when it dries it turns golden and dormant, and it greens up
  again within moments of being wetted.

`src/shaders/render.js` shades the result: relief shadows, light bleeding
through the shoots, dew, and sunlight filtering through a canopy (komorebi).

## Controls

| | |
|---|---|
| Drag | apply the selected tool |
| `1`–`4` | Sow, Mist, Warm, Scrape |
| `R` | rain |
| Wheel, `[` `]` | brush size |
| Climate | time, humidity, canopy light, surface |

Slow GPU? Lower the grids with `?sim=512&sub=1024`.
