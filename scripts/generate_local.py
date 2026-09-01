"""
Local Stable Diffusion image generation script.
Runs entirely offline using Hugging Face Diffusers with memory optimizations for 4GB VRAM.

Supports:
- GPU acceleration (CUDA) with CPU fallback
- Model CPU offloading for low VRAM
- Progress reporting via stdout JSON lines
- Cancellation via SIGTERM
- Model listing and management

Usage:
    python generate_local.py generate --prompt "a cat" --output_path ./out.png
    python generate_local.py list-models --models_dir ./models
    python generate_local.py detect-hardware
"""

import argparse
import json
import sys
import os
import signal
import threading
from pathlib import Path

# Global cancellation flag
_cancelled = False

def signal_handler(sig, frame):
    global _cancelled
    _cancelled = True
    print(json.dumps({"type": "cancelled"}), flush=True)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


def report_progress(step: int, total: int):
    """Report generation progress as JSON line to stdout."""
    pct = round((step / total) * 100) if total > 0 else 0
    print(json.dumps({"type": "progress", "step": step, "total": total, "percent": pct}), flush=True)


def report_status(msg: str):
    """Report status as JSON line to stdout."""
    print(json.dumps({"type": "status", "message": msg}), flush=True)


def detect_hardware():
    """Detect available hardware and return capabilities."""
    info = {"cuda": False, "directml": False, "cpu": True, "vram_mb": 0, "device_name": "CPU"}

    try:
        import torch
        if torch.cuda.is_available():
            info["cuda"] = True
            info["device_name"] = torch.cuda.get_device_name(0)
            info["vram_mb"] = round(torch.cuda.get_device_properties(0).total_mem / (1024 * 1024))
    except Exception:
        pass

    # Check DirectML
    try:
        import torch_directml
        dml_device = torch_directml.device()
        info["directml"] = True
        if not info["device_name"] or info["device_name"] == "CPU":
            info["device_name"] = "DirectML GPU"
    except Exception:
        pass

    return info


def list_models(models_dir: str):
    """List installed local models."""
    models_path = Path(models_dir)
    models = []

    if not models_path.exists():
        print(json.dumps({"models": []}))
        return

    for item in models_path.iterdir():
        if item.is_dir():
            model_index = item / "model_index.json"
            config_file = item / "model_index.json"
            has_pipeline = (item / "unet").exists() or (item / "transformer").exists()

            if model_index.exists() or has_pipeline:
                # Get model size
                total_size = 0
                try:
                    for f in item.rglob("*.safetensors"):
                        total_size += f.stat().st_size
                    for f in item.rglob("*.bin"):
                        total_size += f.stat().st_size
                except Exception:
                    pass

                # Try to read model config
                model_type = "stable-diffusion"
                try:
                    if model_index.exists():
                        with open(model_index, 'r') as f:
                            config = json.load(f)
                            model_type = config.get("_class_name", model_type)
                except Exception:
                    pass

                models.append({
                    "name": item.name,
                    "path": str(item),
                    "size_bytes": total_size,
                    "size_label": format_size(total_size),
                    "type": model_type,
                    "has_required_files": has_pipeline,
                })

    print(json.dumps({"models": models}))


def format_size(size_bytes: int) -> str:
    if size_bytes >= 1024**3:
        return f"{size_bytes / 1024**3:.1f} GB"
    elif size_bytes >= 1024**2:
        return f"{size_bytes / 1024**2:.0f} MB"
    return f"{size_bytes} B"


def generate_image(args):
    """Generate an image using local Stable Diffusion."""
    global _cancelled
    _cancelled = False

    try:
        report_status("Loading dependencies...")
        import torch
        from diffusers import StableDiffusionPipeline, UniPCMultistepScheduler

        # Determine device
        device = "cpu"
        dtype = torch.float32

        if args.device == "auto" or args.device == "gpu":
            if torch.cuda.is_available():
                device = "cuda"
                dtype = torch.float16
                vram = torch.cuda.get_device_properties(0).total_mem / (1024**3)
                report_status(f"Using GPU: {torch.cuda.get_device_name(0)} ({vram:.1f} GB)")
            elif args.device == "gpu":
                report_status("GPU not available, falling back to CPU")
                device = "cpu"
                dtype = torch.float32
        elif args.device == "directml":
            try:
                import torch_directml
                device = str(torch_directml.device())
                dtype = torch.float16
                report_status("Using DirectML GPU")
            except ImportError:
                report_status("DirectML not available, using CPU")
                device = "cpu"
                dtype = torch.float32
        else:
            report_status("Using CPU mode")

        # Load model
        model_path = args.model_path
        if not model_path:
            print(json.dumps({"success": False, "error": "No model path specified"}))
            sys.exit(1)

        report_status(f"Loading model from {model_path}...")

        load_kwargs = {
            "torch_dtype": dtype,
            "use_safetensors": True,
        }

        pipe = StableDiffusionPipeline.from_pretrained(model_path, **load_kwargs)

        report_status("Configuring pipeline for low memory...")

        # Memory optimizations for 4GB VRAM
        if device == "cuda":
            pipe.enable_model_cpu_offload()
            pipe.enable_attention_slicing(slice_size="auto")
            try:
                pipe.enable_vae_tiling()
            except Exception:
                pass
        elif device == "cpu":
            pipe.enable_attention_slicing(slice_size="auto")
            try:
                pipe.enable_vae_tiling()
            except Exception:
                pass

        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

        # Set seed
        generator = None
        if args.seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(args.seed)

        # Generate with progress callback
        total_steps = args.steps
        report_status(f"Generating image ({args.width}x{args.height}, {total_steps} steps)...")

        def progress_callback(pipe, step, timestep, callback_kwargs):
            if _cancelled:
                raise RuntimeError("Generation cancelled")
            report_progress(step + 1, total_steps)
            return callback_kwargs

        result = pipe(
            prompt=args.prompt,
            width=args.width,
            height=args.height,
            num_inference_steps=total_steps,
            generator=generator,
            callback_on_step_end=progress_callback,
        )

        if _cancelled:
            print(json.dumps({"success": False, "error": "cancelled"}))
            sys.exit(0)

        image = result.images[0]

        output_path = os.path.abspath(os.path.expandvars(args.output_path))
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        image.save(output_path, "PNG")

        # Clean up
        del result
        del pipe
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        report_status("Complete")
        print(json.dumps({"success": True, "path": output_path}))
        sys.exit(0)

    except RuntimeError as e:
        if "cancelled" in str(e).lower():
            print(json.dumps({"success": False, "error": "cancelled"}))
        else:
            print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
    except ImportError as e:
        print(json.dumps({"success": False, "error": f"Missing dependency: {str(e)}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Local Stable Diffusion image generation")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Generate command
    gen_parser = subparsers.add_parser("generate", help="Generate an image")
    gen_parser.add_argument("--prompt", type=str, required=True, help="Text prompt")
    gen_parser.add_argument("--output_path", type=str, required=True, help="Output file path")
    gen_parser.add_argument("--width", type=int, default=512, help="Width (default: 512)")
    gen_parser.add_argument("--height", type=int, default=512, help="Height (default: 512)")
    gen_parser.add_argument("--steps", type=int, default=20, help="Inference steps (default: 20)")
    gen_parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for random)")
    gen_parser.add_argument("--model_path", type=str, default=None, help="Local model path")
    gen_parser.add_argument("--device", type=str, default="auto", choices=["auto", "gpu", "cpu", "directml"])

    # List models command
    list_parser = subparsers.add_parser("list-models", help="List installed models")
    list_parser.add_argument("--models_dir", type=str, required=True, help="Models directory")

    # Detect hardware command
    subparsers.add_parser("detect-hardware", help="Detect hardware capabilities")

    args = parser.parse_args()

    if args.command == "generate":
        generate_image(args)
    elif args.command == "list-models":
        list_models(args.models_dir)
    elif args.command == "detect-hardware":
        info = detect_hardware()
        print(json.dumps(info))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
