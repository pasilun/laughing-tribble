# Spike: pretrained floor-plan models against the custom tracer

Written 2026-11-12. Not started.

## Question

On a real archive drawing, does a pretrained raster-to-vector model trace walls, windows and doorways better than
Planstudio's own tracer, and could Planstudio use it (licence, how it runs, cost)?

## The bar to beat

`e2e/bench-trace-1999.spec.ts` on the 1999 survey of lgh 152–154 (`e2e/fixtures/flat/drawing-1999.json`):

| | Custom tracer today |
|---|---|
| Wall length found within 100 mm | 61.9 % |
| Traced length on a real wall | 84.1 % |
| Median offset | 12 mm |
| Windows | 7 of 7 (3 extra) |
| Doorways | 6 of 23 |
| Time | about 17 s on the server |

## Candidates (desk check 2026-11-12, to be confirmed in step 1)

| Model | What it is | Code and weights | Licence | Runs on |
|---|---|---|---|---|
| CubiCasa5k model (Aalto, 2019) | Multi-task network on the Raster-to-Vector architecture: wall junction heatmaps, room and icon segmentation | Official repo with a weights download | Code licence not yet read; the dataset is CC BY-NC 4.0 | Python 3.6, PyTorch 1.0, GPU in the original; needs updating, CPU should work for one image |
| Raster-to-Graph (CGF 2024) | Transformer that predicts the floor plan as a graph of corners and walls | Repo named in the paper (HSZVIS/Raster-to-Graph); weights not confirmed | Not yet read | Python, PyTorch |
| FloorplanVLM (arXiv 2026) | A vision-language model that writes the vector plan as a sequence; reports 92.5 % exterior-wall overlap | No official code or weights found; community Qwen2.5-VL-3B adapters "following" it exist | Community adapters: research and non-commercial only (trained on CubiCasa5K) | A 3B model: CPU possible but slow; a GPU is realistic |
| FloorplanTransformation (Raster-to-Vector, 2017) | The older method CubiCasa builds on | Original authors' repo | MIT | Python, old TensorFlow/PyTorch |

Risk that applies to all: they were trained on modern, clean, mostly Finnish or Chinese plans, not 1999 Swedish surveys
drawn by hand with thin double lines. The licence of anything trained on CubiCasa5K is likely non-commercial.

## Steps (one session, time-boxed)

1. **Confirm (30 min).** For each candidate: read the LICENSE, check that weights download, note input size and output
   format. Keep the two that can run here and whose licence fits. Stop if none can.
2. **Run offline (2 h).** In this sandbox, CPU only, outside the app: a Python virtual environment under the scratchpad,
   one image (the crop `e2e/fixtures/flat/a00-crop.png`, 1411 × 1740 px). Nothing in the repo changes.
   Needs: PyTorch CPU wheels and the weights. Downloads go through the session's proxy; GitHub and package registries are
   allowed, but Google Drive or Hugging Face may need adding to the environment's network list.
3. **Convert (in the same 2 h).** Turn each model's output into Planstudio walls and openings in plan mm with
   `case.json` (8.5039 mm/px, offset 18496, 6999). Vector outputs map directly; masks need a line fit (the custom
   code's snapping can do it).
4. **Score** with `lib/plan/bench/score.ts`, the same numbers as the table above, plus time and memory per image.
5. **Look** at an overlay of each result on the drawing: where it beats or loses to the custom tracer (double-line walls,
   door markings, text, fixtures).

## Decision rule

- **Clearly better and usable** (for example 75 % or more of wall length at similar precision, or most doorways) and a
  licence that fits: plan a small Python service that `source` (action "trace") calls. Where it is hosted is a
  separate decision (it cannot run in a Vercel function).
- **Better at one thing only** (most likely doorways or room shapes): use it for that part only, behind the same action.
- **Not better:** keep the custom tracer. Next step there: Claude as a filter that labels each proposal as wall, text,
  fixture or door marking (positions still come from the ink), aimed at the false walls from labels and fixtures.

In every case the connector contract does not change: a better tracer is a better answer from the same call.

## Open questions for the maintainer

- **Licence:** is Planstudio commercial? If so, models trained on CubiCasa5K are probably out.
- **Hosting:** a model that needs a GPU means a paid service outside Vercel. Is that acceptable at all?
- **Test set:** one drawing is thin. If a model looks promising, the cellar drawing needs a reference too.

## Sources

- FloorplanVLM: https://arxiv.org/abs/2602.06507
- Community adapter (licence note): https://huggingface.co/minemaster01/qwen25-vl-3b-floorplan-grpo
- CubiCasa5k: https://github.com/CubiCasa/CubiCasa5k and https://arxiv.org/abs/1904.01920
- Raster-to-Graph: https://diglib.eg.org/handle/10.1111/cgf15007
- FloorplanTransformation (Raster-to-Vector): https://github.com/art-programmer/FloorplanTransformation

## Result (2026-11-13)

FloorplanVLM itself is not released (no code or weights; the paper promises only its benchmark). The only runnable form,
the community LoRA adapter `minemaster01/qwen25-vl-3b-floorplan-grpo` on Qwen2.5-VL-3B, was run on the crop on a cloud
CPU (bf16): 4096 tokens in 17 minutes (3.9 tokens/s), cut off at the limit. The 92 walls and 15 openings recovered from
it score **0 % of wall length within 100 mm** (11 % within 200), median offset 184 mm, 0 of 7 windows, 0 of 23 doorways;
its outline is about 600 mm wider than the image. Dropped. Next decision: a workflow for the user's own Claude, see
`docs/trace-workflow-plan.md`. `Yytsi/floorplan-to-3d-walls` (MIT, a 98 MB UNet on CubiCasa5K) remains an optional cheap
probe.
