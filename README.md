# Paddock Planner

A personal planning tool for mount breeding (Dragoturkeys, Muldos, Volkornes) in **DOFUS 3 (Unity) 3.7**.
Enter your mounts and the fuel loaded in your paddock, and it tells you:

- **which mounts to put in the paddock** and **which 2 gauges to turn on**;
- **when to check in** and what to change (a multi-step schedule with events);
- how much fuel is missing to make the whole stable fecund;
- the **expected value** of each breeding;
- what to do with sterile mounts (clone or extract).

Data is stored in the browser's `localStorage`. Use **Download backup (.json)** to keep a copy or move to another device.

## Usage

1. Open the site (GitHub Pages) or `index.html` directly in a browser.
2. In **Stable**, update each mount's Endurance, Maturity, Love and Serenity.
3. In **Fuel**, enter the fuel loaded in each gauge.
4. Follow the top panel and come back at the suggested time.

## Game rules used (verified)

| Rule | Value (3.7) |
|---|---|
| Active gauges | at most 2; serenity loss and gain are mutually exclusive |
| Gauge capacity | 200,000, tiers at 80k / 140k / 180k / 200k |
| Gain per mount | 10 / 20 / 30 / 40 every 10 s (tier 1–4) |
| Fuel burn | independent of mount count; no burn when no mount benefits |
| Endurance | serenity −5,000 to −1 |
| Maturity | serenity −2,000 to +2,000 |
| Love | serenity 0 to +5,000 |
| Fecund | Endurance, Maturity and Love at 20,000 |
| Breeding | 1 foal; both parents become sterile; no gestation |
| Target generation chance | 30% (÷ number of targets) + 0.15% × (sire level + dam level) + 20% with Optimakina |
| Cloning | 2 of the same generation and species → 1 fertile (keeps sex, genealogy and serenity) |
| Extraction | 1 resource per generation; Gen 1 cannot be extracted |

**Unverified assumptions:**
- Serenity gauges move serenity at the same per-tier rate as other gauges.
- Serenity does not drift on its own.

Compare predictions with in-game observations and calibrate `simulate()` in `planner.js`.

### Sources
- Dofus pour les Noobs — [Guide de l'éleveur (édition 2026)](https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html), updated 2026-10-13
- Dofus pour les Noobs — [Présentation de la màj 3.7](https://www.dofuspourlesnoobs.com/mise-a-jour-307.html)
- Dofus pour les Noobs — [Présentation de la màj 3.5](https://www.dofuspourlesnoobs.com/mise-a-jour-305.html)

Guides older than 3.5 (2026-03-03) do not apply to breeding. For gauge numbers, only use sources newer than 3.7 (2026-10-06).

## Gauge names

| Planner | In game (FR) |
|---|---|
| Serenity loss | Baffeur |
| Serenity gain | Caresseur |
| Endurance | Foudroyeur |
| Maturity | Abreuvoir |
| Love | Dragofesse |
| Experience | Mangeoire |

## Project structure

```
index.html        UI (initial state embedded in <script id="initial-state">)
planner.js        Pure logic: rules, simulation, batch selection (browser + Node)
test/             Tests (node:test)
.github/workflows Tests + GitHub Pages deploy on every push to main
```

## How the algorithm works

1. Each fertile, non-fecund mount gets a **target serenity zone**, preferring the double zones: −2,000 to −1 (Endurance and Maturity) and 0 to 2,000 (Maturity and Love).
2. For every fueled gauge combination (at most 15 pairs), it picks the mounts that benefit most, up to the slot limit, and **simulates 6 hours** in 2-minute steps.
3. It picks the combination with the most progress. Moving towards the target zone counts 0.6 per point.
4. A step ends when an active gauge stops helping, output drops by half, fuel runs out or 12 hours pass. The next step is planned from the simulated state.

## Development

```bash
npm test        # run tests
npm start       # local server at http://localhost:3000
```

## Deploy

On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push to `main` runs the tests and deploys.

## Roadmap

- [ ] Measure serenity gauge rate and natural drift in game; calibrate `simulate()`
- [ ] Market log (fertile vs. fecund prices) and sales with net profit
- [ ] Breeding log (outcome when the target generation is missed)
- [ ] User accounts / cross-device sync

## License

MIT
