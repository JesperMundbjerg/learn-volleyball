# 🏐 5-1 Volleyball Lab

An interactive 3D trainer for the **5-1 volleyball system**. It shows where all six players stand and how they move in serve receive, serving, defense, transition and attack coverage.

It's a plain static site (HTML + ES modules + [three.js](https://threejs.org) from a CDN), so there's no build step. It works on desktop and on phones.

## Features

- **Rotations H1–H6**: H = the zone the setter starts in. A mini zone map shows everyone's rotational spot, and the start formation is checked against the overlap rule.
- **Scenarios**
  - *Serve receive*: pass → outside, middle quick, opposite (or back-row "D" when the setter is front row), pipe
  - *Our serve & defense*: switch to base, block and defend their outside, right side or quick, then dig and counter-attack
  - *Special situations*: our attack gets blocked (cover and recover), deep-corner attack, tip over the block, free ball
- **Highlight** roles (S, OH1, OH2, MB1, MB2, OPP, L), or tap a player
- **Play speed** from 0.1× to 2×, a scrubbable timeline, phase-by-phase stepping, and auto-pause at each phase
- Ball trail, landing-point markers, contact flashes and player movement paths
- **Random** mode varies where serves and attacks land. Whoever is closest takes the ball, and the setting rules adapt (e.g. the libero bump-sets when the setter digs).
- Camera views: behind the team, top, side, coach, opponent

## Run locally

Any static file server works, for example:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

## Host free on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**, set *Source* to "Deploy from a branch", and pick branch `main` with folder `/ (root)`.
3. After a minute the site is live at `https://<your-user>.github.io/<repo-name>/`.

## Project layout

| File | What it does |
| --- | --- |
| `js/engine.js` | Deterministic timeline: player moves, jumps, ball arcs and phases, all as functions of time |
| `js/volleyball.js` | Volleyball logic: rotations, receive formations, offense, defense, coverage and the scenarios |
| `js/main.js` | three.js scene, rendering and UI |
| `css/style.css` | Styling, including the phone bottom-sheet layout |

## Adding a scenario

Scenarios are small functions in `js/volleyball.js` built from reusable pieces:

- `serve(...)` and `sideOut(...)`: serve, pass, setter release
- `offense(...)`: approaches, decoys, set, attack, coverage cup
- `defend(...)`: block and perimeter defense, picks the digger
- `digAndCounter(...)`: dig and transition attack (handles the libero/opposite setting when the setter digs)

Write a function that chains these together, add captions with `tl.phase(time, title, html)`, and register it in the `SCENARIOS` list.
