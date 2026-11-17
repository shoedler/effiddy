# effiddy tooling

Local build + verification for `ergogen/config.yml`. The point is to be able to
change a unit and immediately see whether the PCB, the top case and the two
bottom cases are all still sane — without pasting into ergogen.xyz (which takes
minutes on the bottom cases) and eyeballing it.

Everything here is optional: the config is still a plain ergogen config you can
paste into <https://ergogen.xyz>.

The tooling was ported from [ezy54](https://github.com/shoedler/ezy54); its
ezy54-specific checks were replaced by `check.ts` below.

## Setup

Needs **Node 22.18+** (for running TypeScript without a build step) and
**git**. Then:

```bash
cd tools && npm run setup
```

That installs the node dependencies and clones
[ceoloide/ergogen-footprints](https://github.com/ceoloide/ergogen-footprints)
into `tools/vendor/` (gitignored — it carries its own licence).

The tools are TypeScript and run directly: `node tools/check.ts`, no build, no
`dist/`. `npm --prefix tools run typecheck` runs `tsc --noEmit` over them, and
`npm --prefix tools test` runs the unit tests.

## Build

```bash
node tools/build.ts
```

Writes `out/` — `outlines/`, `cases/`, `pcbs/effiddy.kicad_pcb`, and (because
it runs ergogen in debug mode) `points/points.yaml` + `points/units.yaml`. Takes
a few seconds.

## Checks

### `node tools/check.ts`

Switch fit in the bottom cases. Reads every switch's centre post hole and Choc
v1 peg holes out of the generated board, then probes **both** bottom cases
(`effiddy_case_bottom_left` and `_right` — they differ, because the hotswap
sockets sit differently on each half) at the centre and rim of each hole, at
several depths below the PCB. Any material there means a switch will not sit
flat. Exits non-zero on a failure.

```
=== effiddy_case_bottom_left ===
  ok   centre post  25/25 clear
  ok   choc v1 peg  50/50 clear
```

Switch pins are not checked: they sit in the hotswap sockets, and the
reversible footprint drills both sides' pin holes, so half of them are
legitimately covered.

### `node tools/drc-lite.ts`

A KiCad-free pre-flight on the generated board:

- copper too close to, or hanging off, the board edge
- pads of different nets too close together
- drilled holes too close to the board edge
- the GND pour still covering the board — its polygon is **literal
  coordinates** in the config (ergogen does not resolve unit names inside
  nested arrays), so nothing else keeps it in sync with the layout.

Thresholds default to JLCPCB's (`--edge 0.3 --pad 0.2 --hole 0.5`).

It deliberately does **not** check courtyard overlaps: every switch overlaps its
own diode here, which is normal for a keyboard.

### `node tools/drc.ts` — the real thing

Runs `kicad-cli pcb drc` and summarises it. Needs KiCad 8+ on PATH. Run it on
the generated board before routing, and again on `kicad/effiddy.kicad_pcb`
after.

On an unrouted board every net is reported as an unconnected item — that is
expected, look at the `violations` group.

### `npm --prefix tools test`

Unit tests over the geometry, the s-expression reader and the formatting, plus
a regression test for the footprint rotation convention — see "the rotation
gotcha" below. Run it whenever you touch `lib/geom.ts`.

## Cases

```bash
node tools/cases.ts
```

Evaluates each generated `.jscad` (they use the CSG v1 API) into `out/stl/`,
reporting bounds and volume — a negative or wildly wrong volume means the
booleans went bad.

`tools/jscad.ts` does one case at a time and can do more:

```bash
# cross section through the bottom case along a key row, as an SVG
node tools/jscad.ts out/cases/effiddy_case_bottom_left.jscad \
    --cut "y=-150" --svg out/section.svg --scale 6

# is there material at this point? (here: a Choc v1 peg of the first key)
node tools/jscad.ts out/cases/effiddy_case_bottom_left.jscad \
    --probe "pocket:150,-150,0.8;peg:155.5,-150,2.6"
```

`--probe` ray-casts the mesh and answers SOLID/empty per point. It is the
fastest way to confirm a wall, a lip or a cutout is really where you think. The
bottom cases are modelled upside down: the PCB pocket is z 0..1.6, the floor
z 1.6..3.6.

## Drawings

```bash
node tools/render.ts out --o _casebottom_left_cutouts:#000:0.15 \
     --o effiddy_pcb:#08f:0.15 --points --crop 135,-200,215,-120 \
     --scale 10 --out out/bottom_left.svg
node tools/svg2png.ts out/bottom_left.svg out/bottom_left.png 1100
```

`--o name[:colour[:width]]` layers any generated outline; `--points`/`--labels`
overlay the ergogen points; `--crop x0,y0,x1,y1` zooms in. Coordinates are
ergogen's (y up), matching `points.yaml`.

## The rotation gotcha

Worth reading before you move a footprint, because it is silent — it cost ezy54
a PCB revision.

Ergogen works y-up and negates y when it writes the board. Footprint bodies,
though, are authored in KiCad's own y-down frame and placed with a rotation of
`key rotation + adjust.rotate`. To work out where a pad actually lands you need
KiCad's rotation convention, and it is the counter-intuitive one: angles are
counter-clockwise *as displayed*, and the file's y axis points down, so in file
coordinates a footprint-local offset is rotated by **minus** the angle:

```
x' =  x·cos(t) + y·sin(t)
y' = -x·sin(t) + y·cos(t)
```

Get that sign backwards and the y component of every footprint-internal offset
flips on any rotated footprint.

With the correct convention there is no dependence on the key's rotation at
all. Substituting `R = r + A` into the two transforms gives a footprint-local
offset, expressed in its own key's frame, of

```
Lx = lx·cos(A) + ly·sin(A)
Ly = lx·sin(A) - ly·cos(A)
```

— only `adjust.rotate` appears. A footprint's geometry sits in the same place
relative to every key, however splayed.

`lib/geom.ts` has the two conventions side by side as `rotateKicad` (this one)
and `rotateCcw` (ergogen's own y-up frame); confusing them is the mistake.
`test/rotation.test.ts` pins it down: it compares the computed hole positions
in `kicad/effiddy.kicad_pcb` against the Excellon coordinates KiCad itself
produced, read out of the committed `kicad/gerber.zip`. Run
`npm --prefix tools test` after touching `rotateKicad`.

## Layout

| | |
|---|---|
| `build.ts` | ergogen config → `out/` |
| `cases.ts` | every `.jscad` → `out/stl/` |
| `jscad.ts` | one `.jscad`: stats, STL, probes, sections |
| `check.ts` | switch fit in both bottom cases |
| `drc-lite.ts` | KiCad-free pre-flight on the board |
| `drc.ts` | `kicad-cli` DRC, summarised |
| `render.ts` | outlines + points → SVG |
| `svg2png.ts` | SVG → PNG |
| `fetch-footprints.ts` | clone/update the vendored footprint library |
| `lib/` | the shared core: CLI parsing, formatting, geometry, KiCad and outline models, the JSCAD runtime |
| `test/` | `node --test` unit tests |
| `vendor/` | third-party, gitignored, do not edit |

One thing in `lib/` looks stranger than it is: `fmt.ts` reimplements Python's
number formatting and `geom.ts` has its own `hypot`. These tools were ported
from Python, and their output is diffed against the originals; `toFixed` and
`Math.hypot` each disagree with Python often enough to change a printed digit
or reorder two tied rows. Both are commented and tested.
