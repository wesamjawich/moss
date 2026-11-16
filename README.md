# Koke — a moss garden

Design a small Japanese moss garden seen from above, then watch the moss take it over.
Place rocks, branches, a lantern, a water basin, a Jizō statue; lay gravel and rake it;
scatter maple leaves; choose the hour of the day; save a picture to share.

A 40-second walkthrough is in [`demo/koke-demo.mp4`](demo/koke-demo.mp4); `scripts/record-demo.cjs` re-records it.

```
npm install
npm run dev      # develop
npm run build    # one self-contained dist/index.html
```

## Making a garden

| Tab | What it does |
|---|---|
| **Moss** | Sow spores, mist, warm (dry), scrape, or call rain |
| **Ground** | Paint gravel or soil, rake furrows into gravel, scatter or sweep maple leaves |
| **Objects** | Tap to add a rock, flat stone, branch, lantern, basin, Jizō or bridge; drag to move; size, turn or remove the selected one |
| **Scene** | Dawn / day / dusk / night, time speed, humidity, canopy light, brush size, cherry petals, start a new garden |

Top right: sound (wind, rain, water drips), hide the controls, save a picture.
Keys: `1`–`5` tools, `R` rain, `H` hide controls, `P` picture, `[` `]` brush size,
wheel to resize the brush or the selected object (shift-wheel turns it), `Delete` removes it.

The garden is kept in the browser's local storage and restored on the next visit.
Add `?fresh` to the address to start over. Slow GPU? Lower the grids with `?sim=512&sub=1024`.

## How it works

Everything is a top-down height field. `src/shaders/bake.js` composes the relief from the
painted ground map (soil, gravel, rake furrows) and every placed object, then derives
concavity, habitat suitability and dampness from it. The moss simulation
(`src/shaders/sim.js`) runs on that, so moss responds to whatever is built:

- **Water** condenses with humidity, runs downhill, pools at the foot of rocks and in
  furrows, and evaporates faster on sunlit faces. Soil holds it, gravel drains it, a basin
  is a permanent spring. Moss cushions hold water like a sponge.
- **Colonisation** happens by creeping contact (a stochastic front biased by habitat) and
  by spores from mature moss through a heavy-tailed dispersal kernel. Wood and soil are
  welcoming, bare stone less so, loose gravel hardly at all.
- **Thickening** is logistic with a carrying capacity set by moisture and shelter.
- **Colour** follows age and hydration: bright new growth, deep mature green with copper
  sporophytes, golden and dormant when dry, green again moments after wetting.

`src/shaders/render.js` shades the result: relief shadows, light through the shoots, dew,
dappled canopy light, still water, lantern light after dark, fallen leaves and ground mist.
