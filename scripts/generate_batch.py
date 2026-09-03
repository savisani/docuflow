"""
Batch Stable Diffusion image generation script.
Loads the model ONCE, generates all images, then releases it.
Optimized for 4GB VRAM with float32 + CPU offloading.

Usage:
    python generate_batch.py --input jobs.json --output_dir ./output
    python generate_batch.py --input jobs.json --output_dir ./output --device auto

Input JSON format:
{
  "model_path": "path/to/model",
  "device": "gpu",
  "default_steps": 10,
  "default_width": 512,
  "default_height": 512,
  "default_negative_prompt": "ugly, blurry",
  "jobs": [
    {
      "scene_id": "scene_001",
      "prompt": "a beautiful landscape",
      "negative_prompt": "ugly, blurry",
      "width": 512,
      "height": 512,
      "steps": 12,
      "seed": 42
    }
  ]
}
"""

import argparse
import gc
import json
import os
import signal
import sys
from pathlib import Path

_cancelled = False

def signal_handler(sig, frame):
    global _cancelled
    _cancelled = True
    print(json.dumps({"type": "cancelled"}), flush=True)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


def report_progress(scene_id: str, step: int, total: int, current: int, total_jobs: int):
    pct = round((step / total) * 100) if total > 0 else 0
    batch_pct = round(((current - 1) / total_jobs) * 100) if total_jobs > 0 else 0
    print(json.dumps({
        "type": "progress",
        "scene_id": scene_id,
        "step": step,
        "total": total,
        "percent": pct,
        "batch_current": current,
        "batch_total": total_jobs,
        "batch_percent": batch_pct,
    }), flush=True)


def report_status(msg: str):
    print(json.dumps({"type": "status", "message": msg}), flush=True)


def _find_safetensors_in_dir(dir_path: Path):
    return [f for f in dir_path.iterdir() if f.suffix == '.safetensors' and f.is_file()]


def _resolve_model_file(model_path: Path):
    candidates = _find_safetensors_in_dir(model_path)
    if not candidates:
        return None
    for f in candidates:
        if 'fp16' in f.name.lower():
            return str(f)
    candidates.sort(key=lambda f: f.stat().st_size, reverse=True)
    return str(candidates[0])


def _is_single_file_model(model_path: str) -> bool:
    p = Path(model_path)
    return p.is_file() and p.suffix == '.safetensors'


def _is_diffusers_dir(model_path: str) -> bool:
    p = Path(model_path)
    if not p.is_dir():
        return False
    return (p / "model_index.json").exists() or (p / "unet").exists() or (p / "transformer").exists()


def generate_batch(args):
    global _cancelled
    _cancelled = False

    try:
        with open(args.input, 'r', encoding='utf-8-sig') as f:
            config = json.load(f)

        jobs = config.get('jobs', [])
        if not jobs:
            print(json.dumps({"success": False, "error": "No jobs provided"}))
            sys.exit(1)

        model_path = config.get('model_path')
        if not model_path:
            print(json.dumps({"success": False, "error": "No model_path in config"}))
            sys.exit(1)

        device_pref = config.get('device', args.device)
        default_steps = config.get('default_steps', 10)
        default_width = config.get('default_width', 512)
        default_height = config.get('default_height', 512)
        default_negative = config.get('default_negative_prompt', '')

        report_status("Loading dependencies...")
        import torch
        from diffusers import StableDiffusionPipeline, UniPCMultistepScheduler

        # === GPU-ONLY POLICY ===
        if not torch.cuda.is_available():
            print(json.dumps({
                "success": False,
                "error": "CUDA GPU not available",
                "detail": "Local image generation requires an NVIDIA CUDA GPU. CPU fallback is disabled.",
            }))
            sys.exit(1)

        device = "cuda"
        dtype = torch.float16  # fp16 for UNet/text_encoder, fp32 for VAE
        gpu_name = torch.cuda.get_device_name(0)
        total_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        report_status(f"GPU: {gpu_name} ({total_vram:.1f} GB VRAM)")

        # Load model ONCE
        report_status(f"Loading model from {model_path}...")
        model_file = Path(model_path)

        if _is_single_file_model(model_path):
            report_status(f"Loading single-file model: {model_file.name}")
            pipe = StableDiffusionPipeline.from_single_file(
                str(model_file),
                torch_dtype=dtype,
                use_safetensors=True,
            )
        elif _is_diffusers_dir(model_path):
            report_status("Loading Diffusers model directory...")
            try:
                pipe = StableDiffusionPipeline.from_pretrained(
                    model_path,
                    torch_dtype=dtype,
                    safety_checker=None,
                    variant="fp16",
                )
            except Exception:
                pipe = StableDiffusionPipeline.from_pretrained(
                    model_path,
                    torch_dtype=dtype,
                    safety_checker=None,
                )
        else:
            safetensors = _find_safetensors_in_dir(model_file)
            if safetensors:
                primary_file = _resolve_model_file(model_file)
                report_status(f"Loading single-file model: {Path(primary_file).name}")
                pipe = StableDiffusionPipeline.from_single_file(
                    primary_file,
                    torch_dtype=dtype,
                    use_safetensors=True,
                )
            else:
                print(json.dumps({"success": False, "error": f"Cannot determine model format for: {model_path}"}))
                sys.exit(1)

        report_status("Configuring pipeline...")
        pipe.enable_attention_slicing(slice_size="auto")
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass

        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

        # === SAFE VAE: Keep VAE in fp32 to prevent NaN/black images ===
        pipe.vae = pipe.vae.to(dtype=torch.float32)

        # Move entire pipeline to CUDA
        report_status("Moving pipeline to GPU...")
        pipe = pipe.to("cuda")

        # Verify device placement
        unet_device = str(pipe.unet.device)
        if "cpu" in unet_device.lower():
            print(json.dumps({
                "success": False,
                "error": "UNet failed to move to GPU",
                "detail": f"UNet is on {unet_device} instead of CUDA.",
            }))
            sys.exit(1)

        report_status(f"Pipeline ready on GPU. UNet={unet_device}, VAE={pipe.vae.device}")

        os.makedirs(args.output_dir, exist_ok=True)

        results = []
        total_jobs = len(jobs)

        for idx, job in enumerate(jobs):
            if _cancelled:
                for remaining_job in jobs[idx:]:
                    results.append({
                        "scene_id": remaining_job.get("scene_id", f"job_{idx}"),
                        "success": False,
                        "error": "cancelled",
                    })
                break

            scene_id = job.get("scene_id", f"job_{idx}")
            prompt = job.get("prompt", "")
            negative_prompt = job.get("negative_prompt", default_negative)
            width = job.get("width", default_width)
            height = job.get("height", default_height)
            steps = job.get("steps", default_steps)
            seed = job.get("seed", -1)

            report_status(f"[{idx+1}/{total_jobs}] Scene {scene_id} - generating...")

            try:
                generator = None
                if seed >= 0:
                    generator = torch.Generator(device="cpu").manual_seed(seed)

                def progress_callback(pipe, step, timestep, callback_kwargs):
                    if _cancelled:
                        raise RuntimeError("Generation cancelled")
                    report_progress(scene_id, step + 1, steps, idx + 1, total_jobs)
                    return callback_kwargs

                gen_kwargs = {
                    "prompt": prompt,
                    "width": width,
                    "height": height,
                    "num_inference_steps": steps,
                    "generator": generator,
                    "callback_on_step_end": progress_callback,
                }
                if negative_prompt:
                    gen_kwargs["negative_prompt"] = negative_prompt

                result = pipe(**gen_kwargs)

                image = result.images[0]
                output_path = os.path.join(args.output_dir, f"{scene_id}.png")
                image.save(output_path, "PNG")

                results.append({
                    "scene_id": scene_id,
                    "success": True,
                    "path": os.path.abspath(output_path),
                })

                report_status(f"[{idx+1}/{total_jobs}] Scene {scene_id} - completed")

                del result
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

            except RuntimeError as e:
                if "cancelled" in str(e).lower():
                    results.append({"scene_id": scene_id, "success": False, "error": "cancelled"})
                    for remaining_job in jobs[idx+1:]:
                        results.append({"scene_id": remaining_job.get("scene_id", "unknown"), "success": False, "error": "cancelled"})
                    break
                else:
                    results.append({"scene_id": scene_id, "success": False, "error": str(e)})
                    report_status(f"[{idx+1}/{total_jobs}] Scene {scene_id} - FAILED: {e}")
            except Exception as e:
                results.append({"scene_id": scene_id, "success": False, "error": str(e)})
                report_status(f"[{idx+1}/{total_jobs}] Scene {scene_id} - FAILED: {e}")

        report_status("Releasing model...")
        del pipe
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        success_count = sum(1 for r in results if r.get("success"))
        fail_count = sum(1 for r in results if not r.get("success"))

        report_status(f"Batch complete: {success_count} success, {fail_count} failed")
        print(json.dumps({
            "success": True,
            "results": results,
            "summary": {"total": total_jobs, "success": success_count, "failed": fail_count},
        }))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Batch Stable Diffusion image generation")
    parser.add_argument("--input", type=str, required=True, help="Input JSON file with jobs")
    parser.add_argument("--output_dir", type=str, required=True, help="Output directory for images")
    parser.add_argument("--device", type=str, default="gpu", choices=["gpu"])

    args = parser.parse_args()
    generate_batch(args)


if __name__ == "__main__":
    main()
