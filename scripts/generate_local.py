"""
Local Stable Diffusion image generation script.
Runs entirely offline using Hugging Face Diffusers with GPU-only execution policy.

Supports:
- CUDA GPU acceleration ONLY (no CPU fallback for inference)
- VRAM availability check before model loading
- Per-model dtype strategy (RV6: fp32 UNet for stability, SD1.5: fp16 for speed)
- Single-file (.safetensors) models with local config to prevent HF downloads
- Progress reporting via stdout JSON lines
- Cancellation via SIGTERM
- Model listing and management
- GPU status reporting

Usage:
    python generate_local.py generate --prompt "a cat" --output_path ./out.png --model_path ./models/realistic-vision-v6
    python generate_local.py list-models --models_dir ./models
    python generate_local.py detect-hardware
    python generate_local.py gpu-status
"""

import argparse
import gc
import json
import os
import signal
import sys
import time
import uuid
from pathlib import Path

PID = os.getpid()
_LOAD_COUNTER = [0]
_GEN_COUNTER = [0]

def _next_load_id():
    _LOAD_COUNTER[0] += 1
    return f"load-{PID}-{_LOAD_COUNTER[0]:04d}"

def _next_gen_id():
    _GEN_COUNTER[0] += 1
    return f"gen-{PID}-{_GEN_COUNTER[0]:04d}"

# Global cancellation flag
_cancelled = False

def signal_handler(sig, frame):
    global _cancelled
    _cancelled = True
    print(json.dumps({"type": "cancelled", "pid": PID}), flush=True)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


def log(tag: str, msg: str, load_id: str = None, gen_id: str = None):
    """Structured log for lifecycle tracking with PID, load_id, gen_id, and timestamp."""
    entry = {"type": "log", "tag": tag, "message": msg, "pid": PID, "ts": round(time.time(), 3)}
    if load_id:
        entry["load_id"] = load_id
    if gen_id:
        entry["gen_id"] = gen_id
    print(json.dumps(entry), flush=True)


def report_progress(step: int, total: int, gen_id: str = None):
    pct = round((step / total) * 100) if total > 0 else 0
    entry = {"type": "progress", "step": step, "total": total, "percent": pct, "pid": PID}
    if gen_id:
        entry["gen_id"] = gen_id
    print(json.dumps(entry), flush=True)


def report_status(msg: str):
    print(json.dumps({"type": "status", "message": msg, "pid": PID}), flush=True)


def get_gpu_status():
    """Get detailed GPU/VRAM status."""
    import torch
    info = {
        "cuda": False,
        "device_name": "CPU",
        "total_vram_gb": 0.0,
        "allocated_vram_gb": 0.0,
        "reserved_vram_gb": 0.0,
        "free_vram_gb": 0.0,
        "supports_fp16": False,
    }
    if torch.cuda.is_available():
        info["cuda"] = True
        info["device_name"] = torch.cuda.get_device_name(0)
        total = torch.cuda.get_device_properties(0).total_memory
        allocated = torch.cuda.memory_allocated(0)
        reserved = torch.cuda.memory_reserved(0)
        info["total_vram_gb"] = round(total / (1024**3), 2)
        info["allocated_vram_gb"] = round(allocated / (1024**3), 2)
        info["reserved_vram_gb"] = round(reserved / (1024**3), 2)
        info["free_vram_gb"] = round((total - allocated) / (1024**3), 2)
        info["supports_fp16"] = torch.cuda.get_device_capability(0)[0] >= 7
    return info


def check_vram_availability(estimated_model_gb: float = 3.0):
    """Check if enough VRAM is available for generation. Returns (ok, details)."""
    import torch
    if not torch.cuda.is_available():
        return False, {
            "error": "CUDA GPU not available",
            "detail": "Local image generation requires an NVIDIA CUDA GPU.",
            "gpu": "None",
            "total_vram_gb": 0,
            "free_vram_gb": 0,
            "required_gb": estimated_model_gb,
        }

    info = get_gpu_status()
    free = info["free_vram_gb"]
    total = info["total_vram_gb"]
    required = estimated_model_gb

    if free < required * 0.6:
        return False, {
            "error": "Not enough GPU VRAM available",
            "gpu": info["device_name"],
            "total_vram_gb": total,
            "allocated_vram_gb": info["allocated_vram_gb"],
            "free_vram_gb": free,
            "required_gb": round(required, 1),
            "detail": f"Need ~{required:.1f} GB free, have {free:.2f} GB free out of {total:.1f} GB total.",
            "action": "Offload unused AI models and try again.",
        }

    return True, info


def detect_hardware():
    info = {"cuda": False, "directml": False, "cpu": True, "vram_mb": 0, "device_name": "CPU"}
    try:
        import torch
        if torch.cuda.is_available():
            info["cuda"] = True
            info["device_name"] = torch.cuda.get_device_name(0)
            info["vram_mb"] = round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))
    except Exception:
        pass
    try:
        import torch_directml
        info["directml"] = True
        if not info["device_name"] or info["device_name"] == "CPU":
            info["device_name"] = "DirectML GPU"
    except Exception:
        pass
    return info


def format_size(size_bytes: int) -> str:
    if size_bytes >= 1024**3:
        return f"{size_bytes / 1024**3:.1f} GB"
    elif size_bytes >= 1024**2:
        return f"{size_bytes / 1024**2:.0f} MB"
    return f"{size_bytes} B"


def _find_safetensors_in_dir(dir_path: Path):
    """Find .safetensors files in a directory (non-recursive, skip subdirs like 'unet', 'vae')."""
    return [f for f in dir_path.iterdir() if f.suffix == '.safetensors' and f.is_file()]


def list_models(models_dir: str):
    models_path = Path(models_dir)
    models = []

    if not models_path.exists():
        print(json.dumps({"models": []}))
        return

    for item in models_path.iterdir():
        if not item.is_dir():
            continue

        model_index = item / "model_index.json"
        has_pipeline = (item / "unet").exists() or (item / "transformer").exists()
        safetensors_files = _find_safetensors_in_dir(item)

        if model_index.exists() or has_pipeline:
            total_size = 0
            try:
                for f in item.rglob("*.safetensors"):
                    total_size += f.stat().st_size
                for f in item.rglob("*.bin"):
                    total_size += f.stat().st_size
            except Exception:
                pass

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
                "format": "diffusers",
                "has_required_files": has_pipeline,
            })
        elif safetensors_files:
            total_size = 0
            try:
                for f in safetensors_files:
                    total_size += f.stat().st_size
            except Exception:
                pass

            models.append({
                "name": item.name,
                "path": str(item),
                "size_bytes": total_size,
                "size_label": format_size(total_size),
                "type": "stable-diffusion",
                "format": "single-file",
                "has_required_files": True,
            })

    print(json.dumps({"models": models}))


def _resolve_model_file(model_path: Path):
    """Given a model directory, find the primary .safetensors file inside it."""
    candidates = _find_safetensors_in_dir(model_path)
    if not candidates:
        return None
    for f in candidates:
        if 'fp16' in f.name.lower():
            return str(f)
    candidates.sort(key=lambda f: f.stat().st_size, reverse=True)
    return str(candidates[0])


def _is_diffusers_dir(model_path: str) -> bool:
    """Check if the model_path is a Diffusers directory."""
    p = Path(model_path)
    if not p.is_dir():
        return False
    return (p / "model_index.json").exists() or (p / "unet").exists() or (p / "transformer").exists()


def _find_local_config_path(model_path: str) -> str:
    """Find the nearest local Diffusers config directory for single-file models.
    
    When loading a .safetensors checkpoint via from_single_file(), Diffusers needs
    pipeline configuration. Without a local config, it extracts a pretrained_model_name
    from the checkpoint metadata and tries to download config from Hugging Face Hub.
    
    This function finds a local Diffusers directory (like stable-diffusion-v1-5/) 
    that can serve as the config source, preventing any network requests.
    """
    models_dir = Path(model_path).parent
    # Look for a Diffusers directory with model_index.json
    for item in models_dir.iterdir():
        if item.is_dir() and (item / "model_index.json").exists():
            return str(item)
    return None


def _configure_tqdm_for_single_display():
    """Configure tqdm to write to stderr and prevent duplicate progress output.
    
    Diffusers' from_single_file() uses logging.tqdm which wraps stdlib tqdm.
    On some terminals (especially Windows/PowerShell), tqdm's initial 0% render
    and subsequent updates can appear duplicated due to stderr buffering.
    
    This forces tqdm to use a single stderr stream with no duplication.
    """
    os.environ["TQDM_DISABLE"] = "0"  # Keep tqdm enabled
    # Redirect tqdm output to stderr explicitly (it already does, but be explicit)
    try:
        import tqdm as tqdm_lib
        # Ensure tqdm doesn't use file= stdout
        orig_init = tqdm_lib.tqdm.__init__
        def patched_init(self, *args, **kwargs):
            kwargs.setdefault('file', sys.stderr)
            orig_init(self, *args, **kwargs)
        tqdm_lib.tqdm.__init__ = patched_init
    except ImportError:
        pass


def generate_image(args):
    global _cancelled
    _cancelled = False

    gen_id = getattr(args, 'generation_id', None) or _next_gen_id()
    load_id = _next_load_id()
    t_script_start = time.time()

    try:
        report_status("Loading dependencies...")
        import torch
        import numpy as np
        from diffusers import StableDiffusionPipeline, UniPCMultistepScheduler

        _configure_tqdm_for_single_display()

        log("SCRIPT START", f"PID={PID} load_id={load_id} gen_id={gen_id}", load_id=load_id, gen_id=gen_id)

        # === GPU-ONLY POLICY ===
        if not torch.cuda.is_available():
            error_msg = {
                "success": False,
                "error": "CUDA GPU not available",
                "detail": "Local image generation requires an NVIDIA CUDA GPU. CPU fallback is disabled.",
                "gpu": "None",
                "total_vram_gb": 0,
                "free_vram_gb": 0,
                "required_gb": 3.0,
                "action": "Install NVIDIA CUDA drivers and ensure a compatible GPU is available.",
            }
            print(json.dumps(error_msg))
            sys.exit(1)

        gpu_name = torch.cuda.get_device_name(0)
        total_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        log("GPU", f"{gpu_name} ({total_vram:.1f} GB VRAM)", load_id=load_id, gen_id=gen_id)

        # VRAM check
        # fp32 UNet ~3.4GB + fp32 VAE ~0.3GB + fp32 TE ~0.5GB + activations ~0.5GB = ~4.7GB peak
        # With attention slicing: ~4.0GB steady state
        estimated_required = 4.0
        ok, vram_info = check_vram_availability(estimated_required)
        if not ok:
            error_msg = {
                "success": False,
                "error": vram_info.get("error", "Insufficient VRAM"),
                "detail": vram_info.get("detail", ""),
                "gpu": vram_info.get("gpu", gpu_name),
                "total_vram_gb": vram_info.get("total_vram_gb", total_vram),
                "free_vram_gb": vram_info.get("free_vram_gb", 0),
                "required_gb": vram_info.get("required_gb", estimated_required),
                "action": vram_info.get("action", "Offload unused AI models and try again."),
            }
            print(json.dumps(error_msg))
            sys.exit(1)

        log("VRAM", f"Check passed: {vram_info['free_vram_gb']:.2f} GB free of {vram_info['total_vram_gb']:.1f} GB", load_id=load_id, gen_id=gen_id)

        # Resolve model path
        model_path = args.model_path
        if not model_path:
            print(json.dumps({"success": False, "error": "No model path specified"}))
            sys.exit(1)

        # Determine model format
        model_file = Path(model_path)
        is_safetensors_file = model_file.is_file() and model_file.suffix == '.safetensors'
        is_safetensors_dir = model_file.is_dir() and not _is_diffusers_dir(model_path) and bool(_find_safetensors_in_dir(model_file))
        is_diffusers = _is_diffusers_dir(model_path)

        log("LOAD START", f"Model: {model_file.name if is_safetensors_file else model_file.name}", load_id=load_id, gen_id=gen_id)
        t_load_start = time.time()

        # === LOAD PIPELINE ===
        # Strategy: Load in fp16 with low_cpu_mem_usage for memory efficiency,
        # then convert VAE to fp32 for stability (prevents black/NaN images on GTX 1650).
        target_dtype = torch.float16

        if is_safetensors_file:
            # Direct path to .safetensors file (e.g. RV6 checkpoint)
            file_size_gb = model_file.stat().st_size / (1024**3)
            log("LOAD", f"Single-file checkpoint: {model_file.name} ({file_size_gb:.2f} GB)", load_id=load_id, gen_id=gen_id)

            # Find local config to prevent Hugging Face Hub downloads
            config_path = _find_local_config_path(str(model_file))
            if config_path:
                log("LOAD", f"Using local config: {config_path}", load_id=load_id, gen_id=gen_id)
            else:
                log("LOAD", "WARNING: No local config found. May attempt HF download.", load_id=load_id, gen_id=gen_id)

            log("LOAD", f"from_single_file START checkpoint={model_file} config={config_path}", load_id=load_id, gen_id=gen_id)
            pipe = StableDiffusionPipeline.from_single_file(
                str(model_file),
                config=config_path,
                safety_checker=None,
                local_files_only=True,
                torch_dtype=target_dtype,
                low_cpu_mem_usage=True,
            )
            log("LOAD", "from_single_file COMPLETE", load_id=load_id, gen_id=gen_id)

        elif is_diffusers:
            # Diffusers directory (e.g. stable-diffusion-v1-5/)
            # Check for fp16 variant files
            unet_dir = Path(model_path) / "unet"
            has_fp16 = (unet_dir / "diffusion_pytorch_model.fp16.safetensors").exists()
            has_default = (unet_dir / "diffusion_pytorch_model.safetensors").exists()
            variant = "fp16" if has_fp16 and not has_default else None
            log("LOAD", f"Diffusers directory: {model_path} (variant={variant or 'default'})", load_id=load_id, gen_id=gen_id)

            load_kwargs = {
                "pretrained_model_name_or_path": model_path,
                "safety_checker": None,
                "local_files_only": True,
                "torch_dtype": target_dtype,
                "low_cpu_mem_usage": True,
            }
            if variant:
                load_kwargs["variant"] = variant
                log("LOAD", f"Using variant={variant} for fp16 weights", load_id=load_id, gen_id=gen_id)

            log("LOAD", f"from_pretrained START path={model_path} variant={variant}", load_id=load_id, gen_id=gen_id)
            pipe = StableDiffusionPipeline.from_pretrained(**load_kwargs)
            log("LOAD", "from_pretrained COMPLETE", load_id=load_id, gen_id=gen_id)

        elif is_safetensors_dir:
            # Directory containing .safetensors files
            primary_file = _resolve_model_file(model_file)
            if not primary_file:
                print(json.dumps({"success": False, "error": f"No .safetensors file found in {model_path}"}))
                sys.exit(1)
            file_size_gb = Path(primary_file).stat().st_size / (1024**3)
            log("LOAD", f"Checkpoint from directory: {Path(primary_file).name} ({file_size_gb:.2f} GB)", load_id=load_id, gen_id=gen_id)

            config_path = _find_local_config_path(str(model_file))
            if config_path:
                log("LOAD", f"Using local config: {config_path}", load_id=load_id, gen_id=gen_id)

            log("LOAD", f"from_single_file START checkpoint={primary_file} config={config_path}", load_id=load_id, gen_id=gen_id)
            pipe = StableDiffusionPipeline.from_single_file(
                primary_file,
                config=config_path,
                safety_checker=None,
                local_files_only=True,
                torch_dtype=target_dtype,
                low_cpu_mem_usage=True,
            )
            log("LOAD", "from_single_file COMPLETE", load_id=load_id, gen_id=gen_id)

        else:
            print(json.dumps({"success": False, "error": f"Cannot determine model format for: {model_path}"}))
            sys.exit(1)

        # === CONFIGURE PIPELINE ===
        log("LOAD", "Configuring pipeline...", load_id=load_id, gen_id=gen_id)
        pipe.enable_attention_slicing(slice_size="auto")
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass
        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

        # Move to CUDA
        log("LOAD", "Moving to GPU...", load_id=load_id, gen_id=gen_id)
        pipe = pipe.to("cuda")

        # For all models: UNet/text_encoder in fp16, VAE in fp32
        # VAE fp32 prevents black/NaN images on GTX 1650
        log("LOAD", "Model loaded: fp16 UNet/text_encoder, fp32 VAE", load_id=load_id, gen_id=gen_id)
        pipe.vae = pipe.vae.to(dtype=torch.float32)
        # Force ALL VAE params to fp32 (from_pretrained can leave them in fp16)
        for module in pipe.vae.modules():
            for param in module.parameters(recurse=False):
                param.data = param.data.to(dtype=torch.float32)
            for buf in module.buffers(recurse=False):
                if buf.is_floating_point():
                    buf.data = buf.data.to(dtype=torch.float32)

        # Wrap decode: UNet outputs fp16 latents, cast to fp32 before VAE
        _original_vae_decode = pipe.vae.decode

        def _safe_vae_decode(z, return_dict=True, generator=None, **kwargs):
            if z.dtype != torch.float32:
                z = z.to(dtype=torch.float32)
            return _original_vae_decode(z, return_dict=return_dict, generator=generator, **kwargs)

        pipe.vae.decode = _safe_vae_decode
        log("LOAD", "VAE: forced fp32 params + decode wrapper (GPU-only)", load_id=load_id, gen_id=gen_id)

        # === VERIFY DEVICE PLACEMENT ===
        unet_device = str(pipe.unet.device)
        unet_dtype = str(pipe.unet.dtype)
        vae_device = str(pipe.vae.device)
        vae_dtype = str(pipe.vae.dtype)
        te_device = str(pipe.text_encoder.device)
        te_dtype = str(pipe.text_encoder.dtype)

        log("VERIFY", f"UNet={unet_device}({unet_dtype}) VAE={vae_device}({vae_dtype}) TextEnc={te_device}({te_dtype})", load_id=load_id, gen_id=gen_id)

        if "cpu" in unet_device.lower():
            print(json.dumps({
                "success": False,
                "error": "UNet failed to move to GPU",
                "detail": f"UNet is on {unet_device} instead of CUDA.",
                "gpu": gpu_name,
                "total_vram_gb": round(total_vram, 2),
                "free_vram_gb": round(vram_info.get("free_vram_gb", 0), 2),
            }))
            sys.exit(1)

        after_load_allocated = torch.cuda.memory_allocated(0) / (1024**3)
        after_load_reserved = torch.cuda.memory_reserved(0) / (1024**3)
        t_load_end = time.time()
        log("LOAD COMPLETE", f"VRAM: {after_load_allocated:.2f}GB allocated, {after_load_reserved:.2f}GB reserved ({t_load_end - t_load_start:.1f}s)", load_id=load_id, gen_id=gen_id)

        # === GENERATE ===
        total_steps = args.steps
        log("GENERATION START", f"{args.width}x{args.height}, {total_steps} steps, {unet_dtype}", load_id=load_id, gen_id=gen_id)

        t_gen_start = time.time()

        generator = None
        if args.seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(args.seed)

        def progress_callback(pipe, step, timestep, callback_kwargs):
            if _cancelled:
                raise RuntimeError("Generation cancelled")
            report_progress(step + 1, total_steps, gen_id=gen_id)
            return callback_kwargs

        gen_kwargs = {
            "prompt": args.prompt,
            "width": args.width,
            "height": args.height,
            "num_inference_steps": total_steps,
            "generator": generator,
            "callback_on_step_end": progress_callback,
        }

        if hasattr(args, 'negative_prompt') and args.negative_prompt:
            gen_kwargs["negative_prompt"] = args.negative_prompt

        result = pipe(**gen_kwargs)

        if _cancelled:
            print(json.dumps({"success": False, "error": "cancelled"}))
            sys.exit(0)

        image = result.images[0]
        t_gen_end = time.time()

        # === BLACK IMAGE CHECK ===
        img_array = np.array(image)
        mean_val = float(img_array.mean())
        max_val = int(img_array.max())
        nonblack = mean_val > 1.0 or max_val >= 5

        log("BLACK CHECK", f"mean={mean_val:.2f} max={max_val} nonblack={nonblack}", load_id=load_id, gen_id=gen_id)

        if not nonblack:
            print(json.dumps({
                "success": False,
                "error": "Generated image is black (mean pixel value < 1.0)",
                "detail": "This indicates a model/dtype compatibility issue.",
                "mean_pixel": round(mean_val, 2),
                "max_pixel": max_val,
                "dtype": unet_dtype,
                "device": unet_device,
            }))
            sys.exit(1)

        # === SAVE ===
        output_path = os.path.abspath(os.path.expandvars(args.output_path))
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        image.save(output_path, "PNG")

        final_allocated = torch.cuda.memory_allocated(0) / (1024**3)
        final_reserved = torch.cuda.memory_reserved(0) / (1024**3)
        log("SAVE COMPLETE", output_path, load_id=load_id, gen_id=gen_id)

        # === CLEANUP (keep pipe in memory for potential reuse, only cleanup result) ===
        del result
        gc.collect()

        gen_time = t_gen_end - t_gen_start
        total_time = time.time() - t_load_start
        log("GENERATION COMPLETE", f"{gen_time:.1f}s | VRAM: {final_allocated:.2f}GB", load_id=load_id, gen_id=gen_id)

        # Report completion
        report_status("Complete")
        print(json.dumps({
            "success": True,
            "path": output_path,
            "device": "cuda",
            "gpu": gpu_name,
            "dtype": unet_dtype,
            "vae_dtype": vae_dtype,
            "steps": total_steps,
            "resolution": f"{args.width}x{args.height}",
            "load_time_s": round(t_load_end - t_load_start, 1),
            "generation_time_s": round(gen_time, 1),
            "total_time_s": round(total_time, 1),
            "vram_after_generate_gb": round(final_allocated, 2),
            "vram_reserved_gb": round(final_reserved, 2),
            "mean_pixel": round(mean_val, 2),
            "max_pixel": max_val,
            "pid": PID,
            "load_id": load_id,
            "gen_id": gen_id,
            "generation_id": getattr(args, 'generation_id', None),
        }))
        sys.exit(0)

    except RuntimeError as e:
        if "cancelled" in str(e).lower():
            print(json.dumps({"success": False, "error": "cancelled"}))
        elif "out of memory" in str(e).lower() or "cuda" in str(e).lower():
            try:
                import torch
                torch.cuda.empty_cache()
            except:
                pass
            print(json.dumps({
                "success": False,
                "error": "CUDA out of memory",
                "detail": str(e),
                "action": "Offload unused AI models, reduce resolution, or reduce steps.",
            }))
        else:
            print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
    except ImportError as e:
        print(json.dumps({"success": False, "error": f"Missing dependency: {str(e)}"}))
        sys.exit(1)
    except Exception as e:
        import traceback
        print(json.dumps({"success": False, "error": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)


def validate_local_model(model_path: str) -> dict:
    """Validate a local model directory or file. Returns validity status with details."""
    p = Path(model_path)
    result = {
        "valid": False,
        "path": str(p),
        "exists": p.exists(),
        "format": None,
        "missing_files": [],
        "warnings": [],
    }

    if not p.exists():
        result["error"] = f"Path does not exist: {model_path}"
        return result

    # Case 1: Single .safetensors file (e.g. RV6)
    if p.is_file() and p.suffix == '.safetensors':
        result["format"] = "single-file"
        size_gb = p.stat().st_size / (1024**3)
        result["size_gb"] = round(size_gb, 2)
        if size_gb < 0.1:
            result["warnings"].append(f"File is very small ({size_gb:.2f} GB), may be corrupted")
        result["valid"] = True
        return result

    # Case 2: Directory
    if not p.is_dir():
        result["error"] = f"Path is not a file or directory: {model_path}"
        return result

    # Check if Diffusers directory
    has_model_index = (p / "model_index.json").exists()
    has_unet_dir = (p / "unet").is_dir()
    has_vae_dir = (p / "vae").is_dir()
    has_text_encoder_dir = (p / "text_encoder").is_dir()
    has_tokenizer_dir = (p / "tokenizer").is_dir()
    has_scheduler_dir = (p / "scheduler").is_dir()

    # Check for safetensors files in root (single-file checkpoint dir)
    safetensors_files = [f for f in p.iterdir() if f.suffix == '.safetensors' and f.is_file()]

    if has_model_index and has_unet_dir:
        result["format"] = "diffusers"

        # Validate model_index.json
        try:
            with open(p / "model_index.json", 'r') as f:
                config = json.load(f)
            result["class_name"] = config.get("_class_name", "Unknown")
        except Exception as e:
            result["warnings"].append(f"Could not read model_index.json: {e}")

        # Check UNet
        if has_unet_dir:
            unet_dir = p / "unet"
            has_config = (unet_dir / "config.json").exists()
            has_fp16_weights = (unet_dir / "diffusion_pytorch_model.fp16.safetensors").exists()
            has_default_weights = (unet_dir / "diffusion_pytorch_model.safetensors").exists()
            has_bin_weights = (unet_dir / "diffusion_pytorch_model.bin").exists()

            if not has_config:
                result["missing_files"].append("unet/config.json")
            if not has_fp16_weights and not has_default_weights and not has_bin_weights:
                result["missing_files"].append("unet/diffusion_pytorch_model.safetensors (or .fp16.safetensors or .bin)")
            else:
                if has_fp16_weights:
                    result["unet_variant"] = "fp16"
                    result["unet_weights"] = "diffusion_pytorch_model.fp16.safetensors"
                elif has_default_weights:
                    result["unet_variant"] = "default"
                    result["unet_weights"] = "diffusion_pytorch_model.safetensors"
                else:
                    result["unet_variant"] = "bin"
                    result["unet_weights"] = "diffusion_pytorch_model.bin"
        else:
            result["missing_files"].append("unet/ directory")

        # Check VAE
        if has_vae_dir:
            vae_dir = p / "vae"
            has_config = (vae_dir / "config.json").exists()
            has_fp16_weights = (vae_dir / "diffusion_pytorch_model.fp16.safetensors").exists()
            has_default_weights = (vae_dir / "diffusion_pytorch_model.safetensors").exists()

            if not has_config:
                result["missing_files"].append("vae/config.json")
            if not has_fp16_weights and not has_default_weights:
                result["missing_files"].append("vae/diffusion_pytorch_model.safetensors (or .fp16.safetensors)")
        else:
            result["missing_files"].append("vae/ directory")

        # Check Text Encoder
        if has_text_encoder_dir:
            te_dir = p / "text_encoder"
            has_config = (te_dir / "config.json").exists()
            has_weights = any(te_dir.glob("*.safetensors")) or any(te_dir.glob("*.bin"))
            if not has_config:
                result["missing_files"].append("text_encoder/config.json")
            if not has_weights:
                result["missing_files"].append("text_encoder/ weights file")
        else:
            result["missing_files"].append("text_encoder/ directory")

        # Check Tokenizer
        if has_tokenizer_dir:
            tok_dir = p / "tokenizer"
            has_vocab = (tok_dir / "vocab.json").exists()
            has_merges = (tok_dir / "merges.txt").exists()
            if not has_vocab:
                result["missing_files"].append("tokenizer/vocab.json")
            if not has_merges:
                result["missing_files"].append("tokenizer/merges.txt")
        else:
            result["missing_files"].append("tokenizer/ directory")

        # Check Scheduler
        if not has_scheduler_dir:
            result["missing_files"].append("scheduler/ directory")
        elif not (p / "scheduler" / "scheduler_config.json").exists():
            result["missing_files"].append("scheduler/scheduler_config.json")

    elif safetensors_files:
        result["format"] = "safetensors-directory"
        result["files"] = [f.name for f in safetensors_files]
        result["valid"] = True
        return result
    else:
        result["error"] = "Directory does not contain model_index.json or .safetensors files"
        return result

    # Final validity check
    if not result["missing_files"]:
        result["valid"] = True
    else:
        result["error"] = f"Missing {len(result['missing_files'])} required file(s)"

    return result


def main():
    parser = argparse.ArgumentParser(description="Local Stable Diffusion image generation (GPU-only)")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    gen_parser = subparsers.add_parser("generate", help="Generate an image")
    gen_parser.add_argument("--prompt", type=str, required=True, help="Text prompt")
    gen_parser.add_argument("--negative_prompt", type=str, default=None, help="Negative prompt")
    gen_parser.add_argument("--output_path", type=str, required=True, help="Output file path")
    gen_parser.add_argument("--width", type=int, default=512, help="Width (default: 512)")
    gen_parser.add_argument("--height", type=int, default=512, help="Height (default: 512)")
    gen_parser.add_argument("--steps", type=int, default=10, help="Inference steps (default: 10)")
    gen_parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for random)")
    gen_parser.add_argument("--model_path", type=str, default=None, help="Local model path")
    gen_parser.add_argument("--device", type=str, default="gpu", choices=["gpu"])
    gen_parser.add_argument("--generation_id", type=str, default=None, help="Unique generation ID from frontend")

    list_parser = subparsers.add_parser("list-models", help="List installed models")
    list_parser.add_argument("--models_dir", type=str, required=True, help="Models directory")

    subparsers.add_parser("detect-hardware", help="Detect hardware capabilities")
    subparsers.add_parser("gpu-status", help="Get detailed GPU/VRAM status")

    validate_parser = subparsers.add_parser("validate-model", help="Validate a local model directory")
    validate_parser.add_argument("--model_path", type=str, required=True, help="Path to model directory or file")

    args = parser.parse_args()

    if args.command == "generate":
        generate_image(args)
    elif args.command == "list-models":
        list_models(args.models_dir)
    elif args.command == "detect-hardware":
        info = detect_hardware()
        print(json.dumps(info))
    elif args.command == "gpu-status":
        info = get_gpu_status()
        print(json.dumps(info))
    elif args.command == "validate-model":
        result = validate_local_model(args.model_path)
        print(json.dumps(result))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
