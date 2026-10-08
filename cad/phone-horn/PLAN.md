# Phone horn speaker: model and print plan

Passive folded exponential horn. The phone stands speaker-down in a slot, and
the sound runs through a smooth 90° bend and flares out to a 150 × 100 mm mouth.
This is a personal shop project and has no connection to the Shop Tycoon app.

## Model (`horn.py`)

`python3 horn.py` writes the following to `out/`:

| File | What it is |
|---|---|
| `horn_half_A.stl`, `horn_half_B.stl` | The two clamshell halves, already laid out in print orientation |
| `horn_assembled.stl` | Both halves joined, for checking only (don't print this) |
| `preview_section.png` | Side section plus a plot checking the flare against the formula |

Design as built:

- **Flare:** area = 90 × e^(0.022 s), measured along the centreline (~600 Hz cutoff). The section grows from 6 × 15 mm at the throat to 100 × 150 mm at 233 mm. The model tracks the formula exactly (see the plot).
- **Bend:** a 10 mm straight drop, then a 90° bend that ends about 57 mm along the path. The centreline radius is 31 mm against a channel about 10 mm wide at that point, which meets the "radius ≥ 2× width" rule.
- **Floor:** flat, so it sits stable on a desk. The extra height goes into the top of the channel, as in the sketch.
- **Walls:** 5 mm all around the channel in the side view. Both outer side faces are flat (160 mm overall width).
- **Phone slot:** 14 × 84 mm and 40 mm deep, centred over the throat.
- **Alignment:** 8 holes per half, sized for short pieces of 1.75 mm filament as dowels.
- **Assembled size:** 210 deep × 160 wide × 110 tall (excluding the phone).

### Changes from the earlier plan

1. **No TPU gasket.** You only have PLA+ and PETG. Use self-adhesive foam weatherstrip (about 3 mm) or EVA craft foam on the slot floor, with a hole cut for the throat.
2. **Flat outer sides instead of a channel-shaped shell.** Each half then prints with its flat side on the bed and the open channel facing up. This needs no supports anywhere, and every inside surface is exposed for sanding before gluing.
3. **The mouth lip is rounded on the top edge only.** The side edges are flat faces. Round them with a file or sandpaper after gluing (about 3–5 mm), or I can add a proper flange in v2.

## G-code plan (Ender 3 Pro, PLA+): not sliced yet

Slice each half on its own, one per plate. A half is 210 × 110 mm on the bed and 80 mm tall, so it fits the 220 × 220 bed with about 5 mm spare on the long axis.

| Setting | Value | Why |
|---|---|---|
| Orientation | As exported: flat outer face down, split face up | No supports needed |
| Supports | Off | Nothing overhangs |
| Layer height | 0.2 mm | |
| Walls | 3 perimeters (1.2 mm) | |
| Top/bottom | 5 / 5 layers | Split face must be flat for gluing |
| Infill | Gyroid, 40% (per the plan) or 20% to save filament | Mass deadens wall ringing |
| Nozzle / bed | 205–215 °C / 60 °C (check the spool label) | Glass bed: clean it, add glue stick if corners lift |
| Speed | 50 mm/s, outer wall 30 mm/s, first layer 20 mm/s | |
| Adhesion | Brim, 5 mm | Long flat part, so the corners can warp |
| Seam | Aligned, rear | Keeps seams out of the channel |
| Ironing | On for the top surface (optional) | Flatter glue face |

**Filament estimate:** about 300 g per half at 40% infill, roughly 600 g total. At 20% infill it's closer to 400 g. Check the spool before starting the second half.

**Print time:** roughly 14–20 hours per half at these speeds. I'll give the exact figure when I slice it.

**Bed leveling:** your bed is manual. Level it with paper at 60 °C. The skirt runs the full 210 mm length, so watch it.

## Assembly

1. Sand the channel faces on both halves (start at 120 grit, finish at 220). Pay most attention to the bend.
2. Dry fit with the filament dowels and check the inside seam lines up.
3. Glue with CA or epoxy. Run a bead of glue or wood filler along the inside seam so no air leaks out.
4. Fit the foam gasket on the slot floor, then put the phone in speaker down.

## Before I export the final G-code, I need

1. **Phone model, or the speaker grille's offset** from the centre of the phone's bottom edge. The throat has to sit under the grille. Samsung phones usually have the grille to one side of the USB port. The value goes into `SPEAKER_OFFSET`.
2. **Phone thickness in its case**, if it's over about 12 mm. The slot is 14 mm.
3. **Infill:** 40% (heavier, more solid) or 20% (cheaper)?
4. **PLA+ brand and the temperature range** printed on the spool label.

## Test plan

Before committing 600 g of filament, print just the slot, throat and bend: the first ~60 mm of the model. I can export that as a separate test STL. It's about a 1.5 hour print and confirms the slot fit, the gasket and the seal with your phone in its case.
