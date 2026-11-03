# Frontline Conquest

A single-player browser strategy game about taking over the world one tile at a time.
It plays on phones (touch) and desktops. Everything runs in the browser: no server, no install.

**Play:** open `index.html` from any static web host (GitHub Pages works). For offline play, open `dist/frontline-conquest.html`, a self-contained file that also runs from `file://`.

## The world
- A 1600 × 613 tile world map (about 981K tiles, 296K of them land), rasterized from public-domain Natural Earth coastlines, with plains, hills, mountains, and biome colours.
- 87 AI nations and 400 tribes by default (both can be changed on the start screen), plus you.

## How to play
1. Tap unclaimed land to place your capital. Spawn protection keeps AI nations from attacking you for a while (3, 2, or 1 minute, depending on difficulty).
2. Choose how many troops to send (10/25/35/50/75%), then tap land beside your border. Your border moves forward tile by tile until the troops you sent are used up.
3. Troops and gold regrow over time. More land means faster growth and a higher troop cap.
4. Tap your own land to build:
   - **City**: raises your troop cap.
   - **Factory**: more gold.
   - **Port**: boat invasions across water. Tap land overseas to send one.
   - **Defense Post**: makes nearby land 3× harder to take.
   - **Missile Silo**: unlocks nukes.
   - **SAM Site**: can shoot down incoming nukes.
5. **Nukes** (Atom or Hydrogen) destroy troops and buildings in a radius and leave fallout. Fallout tiles don't count toward the goal, and anyone can reclaim them.
6. Long-press (or right-click) any territory for its info. From there you can ask for an alliance or break one. AI nations will sometimes offer you an alliance.
7. Own **80% of the world** to win. You lose if all your land is taken.

Controls: drag to pan, pinch or scroll to zoom. On desktop, keys 1–5 set the troop % and Esc cancels.

## Code
- `src/sim.js`: the simulation. It has no DOM, so it runs in Node. Tile ownership is kept in typed arrays, each player has an O(1) border set, attacks keep frontier sets, and AI decisions are throttled.
- `src/render.js`: the canvas renderer. Ownership goes into an offscreen ImageData that is updated only for changed tiles. It also draws territory labels and building, ship, and nuke overlays.
- `src/main.js`: UI, touch and mouse input, and the game loop (10 ticks/s, with 1×/2×/3× speed).
- `tools/buildmap.js`: regenerates `src/mapdata.js` from Natural Earth GeoJSON.
- `tools/bundle.cjs`: builds the single-file `dist/` version.
- `test/simtest.mjs`: a headless simulation run with tick timings: `node test/simtest.mjs standard 10`.

The code and art are original. The gameplay is inspired by territory-conquest .io games.
