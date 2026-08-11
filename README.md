<div align="center">

# 🌍 QuakeLive

**Earth in motion — a live, open-source earthquake explorer.**

Every earthquake on the planet on a satellite map, within about a minute of the seismic
networks publishing it — with the science shown, not just the dots.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Bijaykars/QuakeLive/pulls)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-map-396cb2)](https://maplibre.org/)
[![Vite](https://img.shields.io/badge/Vite-build-646cff?logo=vite&logoColor=white)](https://vite.dev)

<img src="docs/hero.png" alt="QuakeLive — global earthquake map with the Ring of Fire, live event summary and 7-day timeline" width="100%" />

</div>

---

## ✨ What it does

<table>
<tr>
<td width="62%" valign="top">

- 🔴 **Live global feed** — the USGS feed is polled every minute and merged with EMSC's
  real-time WebSocket push, so new earthquakes toast on screen seconds after publication.
  Records are enriched and revised as networks review them, and every revision is tracked.
- 🔥 **Ring of Fire** — the Pacific subduction arcs burn with an animated deep-red ember
  effect (plate boundaries after Bird, 2003).
- 📊 **Seismic summary** — magnitude-class breakdown, strongest event, felt reports and
  shallow-event share over a 24-hour or 7-day window.
- 🕐 **24 h / 7 d timeline** — a scrubbable strip of every event; click a spike to fly there.

</td>
<td width="38%" valign="top">
<img src="docs/summary-panel.png" alt="Seismic summary panel with magnitude-class breakdown" width="100%" />
</td>
</tr>
</table>

## 🔎 Every event, explained

Click any dot and QuakeLive explains it twice on one scrolling page — plain language first,
then the full technical record.

| Plain language | Technical detail |
| --- | --- |
| USGS tectonic summary — *why* it happened here | Full source record (stations, azimuthal gap, RMS…) |
| Official aftershock forecast, 1 day → 1 year | ShakeMap ground-motion curves (PGA, PGV, SA, ±σ) |
| PAGER fatality and economic loss probabilities | Focal mechanism "beachball" from the moment tensor |
| Landslide and liquefaction hazard alerts | Multi-agency tensor comparison, incl. Global CMT |
| "Did You Feel It?" intensity vs distance | Nearest-station seismogram + real analyst picks |
| Radiated energy with TNT / Hiroshima equivalents | ShakeMap finite rupture drawn on the map |
| "How common is this size?" rarity context | CSV / PNG download of the waveform |

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/event-detail.png" alt="Event detail drawer for a M 6.3 — plain-language overview" width="100%" />
</td>
<td width="50%" valign="top">
<img src="docs/seismogram.png" alt="Nearest-station seismogram with predicted P and S arrivals" width="100%" />
<br /><br />
<img src="docs/research-export.png" alt="Research export panel querying the USGS archive to CSV" width="78%" />
</td>
</tr>
</table>

### ⚪⚫ Focal mechanism, computed exactly

The beachball is not a clip-art approximation: every pixel evaluates the P-wave radiation
sign **γᵀ·M·γ** from the published moment tensor in a lower-hemisphere equal-area
projection, so nodal lines emerge exactly where the physics puts them — including
non-double-couple components. Validated against the USGS-published T/P/N principal axes.

<p align="center">
<img src="docs/focal-mechanism.png" alt="Focal mechanism beachball with nodal planes, scalar moment and faulting style" width="470" />
</p>

### 🔬 Every agency's answer, side by side

Large earthquakes get independently analysed by several institutions, and they never agree
exactly. QuakeLive shows all of them — each beachball drawn from that agency's own
published tensor, via the only browser-reachable route to the **Global CMT** catalogue.

<p align="center">
<img src="docs/agency-comparison.png" alt="Six agency moment-tensor solutions for one earthquake, each with its own beachball" width="540" />
</p>

### 📈 The actual wave, and the actual picks

For any event, QuakeLive finds the nearest open seismic station in the EarthScope/IRIS
FDSN archive and draws the real vertical-channel waveform — then overlays **both** the
iasp91 model prediction *and* the genuine USGS analyst pick for that station, with its
timing residual. Model versus reality, on one plot. Raw samples (CSV with metadata header)
and the plot (PNG) are both downloadable — see the seismogram panel above.

### 📐 Know your magnitudes

An interactive explainer of the logarithmic scale: pick two magnitudes and see them drawn
as spheres of TNT (volume ∝ energy), with the calculation shown —
one whole step = 10¹·⁵ ≈ **32× the energy** and 10× the ground motion.

<p align="center">
<img src="docs/magnitude-guide.png" alt="Know your magnitudes — interactive comparison of M 5 and M 7 drawn as TNT spheres" width="560" />
</p>

### 📥 Research export

One click exports what's on screen; or query the full USGS ComCat archive (complete back
to ~1900) by date range, magnitude and map extent — 18 research-ready CSV columns that
open straight into pandas, R or Excel. Shown above next to the event drawer.

## 🚀 Getting started

```bash
git clone https://github.com/Bijaykars/QuakeLive.git
cd QuakeLive
npm install
npm run dev
```

Other commands:

```bash
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
npm run test:identity                                  # EMSC→USGS event-identity merge check
QA_URL=http://localhost:4173 npm run test:interaction  # headless interaction sweep (Chrome/Edge)
```

## ☁️ Hosting

QuakeLive is a fully static single-page app — **no backend, no API keys, no environment
variables**. All data (USGS, EMSC, EarthScope) is fetched by the visitor's browser from
public CORS-enabled APIs, so a hosted copy is exactly as live as a local one.

| Host | Setup |
| --- | --- |
| **Vercel** | Import the repo → framework *Vite* → build `npm run build`, output `dist` |
| **Netlify** | Build `npm run build`, publish directory `dist` |
| **GitHub Pages** | Publish `dist` (set Vite `base` when serving from `/QuakeLive/`) |

## 🛠️ Tech

React 19 · TypeScript (strict) · Vite · MapLibre GL · Zustand · Tailwind CSS 4 —
no UI framework, no chart library; the timeline, seismogram and beachball are hand-drawn
canvas.

## 🗂️ Data sources & attribution

| Data | Source |
| --- | --- |
| Earthquake catalogue & live feeds | [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/) |
| Real-time preliminary events | [EMSC SeismicPortal](https://www.seismicportal.eu/) |
| Waveforms, station metadata, travel times | [EarthScope (IRIS) FDSN web services](https://service.earthscope.org/) |
| Satellite imagery | Esri, Vantor, Earthstar Geographics, and the GIS community |
| Map detail | [OpenFreeMap](https://openfreemap.org/) / OpenStreetMap contributors |
| Plate boundaries | Bird (2003) |

## 🤝 Contributing

Issues and pull requests are welcome — bug reports, feature ideas, translations, science
corrections. Please keep the provenance labelling honest: everything shown is tagged as
*reported*, *calculated*, or *educational estimate*, and new features should do the same.

## ⚠️ Disclaimer

QuakeLive is informational only — **not** an earthquake warning, detection, or prediction
service. Data may be incomplete or revised by the source networks. Always follow official
civil-protection guidance.

## 📄 License

[MIT](LICENSE)
