# Running the floor-plan VLM on the maintainer's PC

Written 2026-11-13 for the spike in `docs/spike-pretrained-scan.md`. The first probe runs in a cloud session on CPU;
this is the plan for running the same model on the maintainer's PC when more runs are wanted (other drawings, other
settings, other models).

## The machine

| Part | Model | What it means here |
|---|---|---|
| GPU | NVIDIA GTX 1080, 8 GB (Pascal, compute capability 6.1) | The model at half precision (about 7.5 GB) does not fit with the image; at 4-bit (about 3–4 GB) it does |
| Spare GPU | GTX 970, 4 GB | Not useful |
| CPU | Intel i7-6700K, 4 cores / 8 threads | Fine; also usable on its own as a slow fallback |
| RAM | 48 GB | Enough for the full model on the CPU at full precision |
| OS | Linux | |

## Software

- **NVIDIA driver:** a recent driver that still supports Pascal. Check with `nvidia-smi`; it must list the GTX 1080.
- **PyTorch:** a build that still includes Pascal (`sm_61`) kernels. Recent PyTorch builds for new CUDA versions may
  have dropped Pascal, so pin a CUDA 11.8 or 12.6 build. First check after installing:
  `python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"`.
  If it prints `False` or warns that the GPU is not supported, try the other CUDA build before anything else.
- **4-bit loading:** `bitsandbytes` (NF4). It works on Pascal for inference in the versions checked by others, but this
  is the part most likely to fail on a 1080; the fallback is the CPU.
- **Python 3.10–3.12**, and `transformers`, `peft`, `accelerate`, `pillow`, `huggingface_hub`.
- **Disk:** about 15 GB (7.5 GB base model, 2 × 150 MB adapters, the environment).

## Setup (once)

```bash
python3 -m venv ~/planstudio-vlm && source ~/planstudio-vlm/bin/activate
pip install --upgrade pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118     # or cu126
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
pip install transformers peft accelerate pillow huggingface_hub bitsandbytes
huggingface-cli download Qwen/Qwen2.5-VL-3B-Instruct --local-dir models/base
huggingface-cli download minemaster01/qwen25-vl-3b-floorplan-grpo --local-dir models/grpo --exclude "checkpoint-*/*" "ref/*"
huggingface-cli download mudasir13cs/qwen25-vl-3b-floorplan-sft --local-dir models/sft --exclude "checkpoint-*/*"
```

## Running

The script is the one the cloud probe uses (`run.py`, to be copied into the repo under `scripts/vlm/` if the probe is
worth repeating), with one addition for the GPU: load in 4-bit when the GPU has less than 10 GB.

```bash
python run.py models/base models/grpo a00-crop.png out/grpo          # final adapter
python run.py models/base models/sft  a00-crop.png out/sft           # first-stage adapter
python run.py models/base models/grpo a00-crop-bw.png out/grpo-bw    # the crop cleaned to black and white
```

Each run writes `<prefix>.raw.txt` (what the model wrote), `<prefix>.json` (the parsed plan, image size, time) and a
log with the speed.

Expected time per run (estimates, to be replaced by measurements): about 1–3 minutes on the GTX 1080 at 4-bit;
20–40 minutes on the CPU at full precision.

## Getting the results back

Either copy the `out/` folder into a shared place and tell the session, or share the folder with the session through
the Claude desktop app (Settings → Claude Code → Remote Control), so it can run and read the files itself.

The session then converts the model's 0–1024 coordinates to plan mm with `e2e/fixtures/flat/case.json`, scores them
with `lib/plan/bench/score.ts` against the 1999 fixture, and draws them over the survey.

## When it is worth it

Only if the cloud probe shows the model reads this kind of drawing at all. Then the PC pays off for: other drawings
(the cellar, other archive sheets), sampling settings, a larger image, and trying other models (CubiCasa5k,
Raster-to-Graph) that need a GPU to be practical.
