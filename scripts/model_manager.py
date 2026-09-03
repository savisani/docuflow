"""
Persistent Model Manager for DocuFlow local AI generation.

This script runs as a long-lived process that maintains exactly ONE diffusion
pipeline on CUDA at any time. It communicates via stdin/stdout JSON commands.

Protocol:
  - Input:  JSON lines on stdin (one command per line)
  - Output: JSON lines on stdout (one response per line)
  - Status: JSON lines on stdout (progress, logs, memory telemetry)

Commands:
  load        - Load a model onto CUDA (unloads previous if different)
  unload      - Explicitly unload the current model from CUDA
  generate    - Generate an image using the currently loaded model
  validate    - Validate a model directory without loading
  status      - Report current model state and VRAM usage
  quit        - Shutdown the worker

GPU Exclusivity:
  - At most ONE pipeline on CUDA at any time
  - Loading a different model automatically unloads the previous
  - Same model reuses the existing pipeline

Usage:
    python model_manager.py
"""

import gc
import json
import os
import signal
import sys
import time
from pathlib import Path

PID = os.getpid()
_log_counter = [0]


def _log(tag: str, msg: str, **extra):
    """Structured log output on stdout."""
    entry = {
        "type": "log",
        "tag": tag,
        "message": msg,
        "pid": PID,
        "ts": round(time.time(), 3),
        "counter": _log_counter[0],
    }
    entry.update(extra)
    _log_counter[0] += 1
    print(json.dumps(entry), flush=True)


def _response(data: dict):
    """Send a response on stdout."""
    print(json.dumps(data), flush=True)


def _vram_snapshot(label: str = "") -> dict:
    """Take a CUDA memory snapshot."""
    import torch
    if not torch.cuda.is_available():
        return {"cuda": False}
    total = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    allocated = torch.cuda.memory_allocated(0) / (1024**3)
    reserved = torch.cuda.memory_reserved(0) / (1024**3)
    snap = {
        "cuda": True,
        "label": label,
        "total_vram_gb": round(total, 3),
        "allocated_vram_gb": round(allocated, 3),
        "reserved_vram_gb": round(reserved, 3),
        "free_vram_gb": round(total - allocated, 3),
    }
    _log("VRAM", f"[{label}] alloc={allocated:.2f}GB res={reserved:.2f}GB free={total-allocated:.2f}GB total={total:.2f}GB", **snap)
    return snap


class ModelManager:
    """Manages exactly one diffusion pipeline on CUDA."""

    def __init__(self):
        self.pipe = None
        self.active_model_path = None
        self.active_model_name = None
        self.active_dtype = None
        self._generation_count = 0

    def is_loaded(self) -> bool:
        return self.pipe is not None

    def is_model(self, model_path: str) -> bool:
        return self.is_loaded() and self.active_model_path == model_path

    def load(self, model_path: str) -> dict:
        """Load a model. If a different model is loaded, unload it first."""
        import torch
        from diffusers import StableDiffusionPipeline, UniPCMultistepScheduler

        model_path = os.path.normpath(model_path)
        model_name = Path(model_path).name

        # Check if already loaded
        if self.is_model(model_path):
            _log("LOAD", f"Model already loaded: {model_name}", model=model_name, action="reuse")
            vram = _vram_snapshot("reuse")
            return {"success": True, "action": "reused", "model": model_name, "vram": vram}

        # Unload previous model if any
        if self.is_loaded():
            _log("LOAD", f"Unloading previous model: {self.active_model_name}", model=self.active_model_name, action="unload-first")
            self.unload()

        _vram_snapshot("before-load")

        # Determine model format
        p = Path(model_path)
        is_safetensors_file = p.is_file() and p.suffix == '.safetensors'
        is_diffusers = p.is_dir() and ((p / "model_index.json").exists() or (p / "unet").exists() or (p / "transformer").exists())
        is_safetensors_dir = p.is_dir() and not is_diffusers and bool([f for f in p.iterdir() if f.suffix == '.safetensors' and f.is_file()])
        is_diffusers_fmt = is_diffusers  # SD1.5 Diffusers format = fp16-aware variant path
        is_rv6_fmt = is_safetensors_file or is_safetensors_dir  # RV6 = single-file fp32

        t_start = time.time()

        # =====================================================================
        # DTYPE + VRAM STRATEGY (GTX 1650 4GB)
        # =====================================================================
        # Root cause of the original bug: from_pretrained(variant="fp16") reads
        # the .fp16.safetensors file but creates nn.Module parameters in fp32
        # unless torch_dtype is explicitly passed. So the model was loaded as
        # fp32 weights inside fp32 modules, consuming ~4GB of VRAM immediately.
        #
        # Strategy:
        #   1. Load with torch_dtype=torch.float32 so parameters are fp32.
        #      Even though SD1.5 ships fp16 weights, Diffusers upcasts them
        #      on load. VAE fp16 produces NaN on this SD1.5 checkpoint, so
        #      keeping VAE in fp32 is required for image validity.
        #   2. ALWAYS enable sequential CPU offload — keeps components on CPU
        #      and streams them to GPU layer-by-layer during forward. This
        #      caps GPU peak memory at ~one component (~700MB) instead of the
        #      full pipeline (~2-4GB) and lets 4GB hardware run SD1.5 cleanly.
        #   3. Unload then reload via enable_sequential_cpu_offload AFTER
        #      .to("cuda") so Accelerate hooks attach correctly.
        # =====================================================================
        target_dtype = torch.float32
        target_variant = None
        _log(
            "LOAD",
            f"dtype strategy: torch_dtype={target_dtype} (is_diffusers_fmt={is_diffusers_fmt})",
            model=model_name,
        )

        if is_safetensors_file:
            _log("LOAD", f"Loading single-file checkpoint: {model_name}", model=model_name, format="single-file")
            config_path = self._find_local_config(model_path)
            if config_path:
                _log("LOAD", f"Using local config: {config_path}", model=model_name)
            pipe = StableDiffusionPipeline.from_single_file(
                str(p),
                config=config_path,
                safety_checker=None,
                local_files_only=True,
                torch_dtype=target_dtype,
            )

        elif is_diffusers:
            _log("LOAD", f"Loading Diffusers directory: {model_name}", model=model_name, format="diffusers")
            unet_dir = p / "unet"
            has_fp16 = (unet_dir / "diffusion_pytorch_model.fp16.safetensors").exists()
            has_default = (unet_dir / "diffusion_pytorch_model.safetensors").exists()
            variant = "fp16" if has_fp16 and not has_default else None

            load_kwargs = {
                "pretrained_model_name_or_path": str(p),
                "safety_checker": None,
                "local_files_only": True,
                "torch_dtype": target_dtype,
            }
            if variant:
                load_kwargs["variant"] = variant
                _log("LOAD", f"Using variant={variant}", model=model_name)

            pipe = StableDiffusionPipeline.from_pretrained(**load_kwargs)

        elif is_safetensors_dir:
            _log("LOAD", f"Loading from directory: {model_name}", model=model_name, format="safetensors-dir")
            primary = self._resolve_safetensors(p)
            if not primary:
                return {"success": False, "error": f"No .safetensors file found in {model_path}"}
            config_path = self._find_local_config(model_path)
            pipe = StableDiffusionPipeline.from_single_file(
                str(primary),
                config=config_path,
                safety_checker=None,
                local_files_only=True,
                torch_dtype=target_dtype,
            )
        else:
            return {"success": False, "error": f"Cannot determine model format for: {model_path}"}

        # Configure pipeline
        _log("LOAD", "Configuring pipeline...", model=model_name)
        pipe.enable_attention_slicing(slice_size="auto")
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass
        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

        if is_diffusers_fmt:
            self.active_dtype = "fp32"
        else:
            self.active_dtype = "fp32"

        _vram_snapshot("before-cuda")

        # Move to CUDA
        _log("LOAD", "Moving to GPU...", model=model_name)
        pipe = pipe.to("cuda")

        # MANDATORY for 4GB: sequential CPU offload. Streams layers to GPU
        # during forward pass, caps VRAM to one component at a time.
        try:
            pipe.enable_sequential_cpu_offload()
            _log("LOAD", "Sequential CPU offload enabled (4GB-safe)", model=model_name)
        except Exception as e:
            _log("LOAD WARN", f"enable_sequential_cpu_offload failed: {e}", model=model_name)

        # Verify device placement
        unet_device = str(pipe.unet.device)
        if "cpu" in unet_device.lower():
            return {"success": False, "error": f"UNet failed to move to GPU: {unet_device}"}

        _log(
            "VERIFY",
            f"UNet={pipe.unet.device}({pipe.unet.dtype}) "
            f"VAE={pipe.vae.device}({pipe.vae.dtype}) "
            f"TextEnc={pipe.text_encoder.device}({pipe.text_encoder.dtype})",
            model=model_name,
        )

        t_load = time.time() - t_start
        vram = _vram_snapshot("after-load")

        self.pipe = pipe
        self.active_model_path = model_path
        self.active_model_name = model_name

        _log("LOAD COMPLETE", f"Loaded {model_name} in {t_load:.1f}s", model=model_name, load_time_s=round(t_load, 1))
        return {"success": True, "action": "loaded", "model": model_name, "load_time_s": round(t_load, 1), "vram": vram}

    def unload(self) -> dict:
        """Unload the current model from CUDA."""
        if not self.is_loaded():
            _log("UNLOAD", "No model loaded", action="noop")
            return {"success": True, "action": "noop"}

        model_name = self.active_model_name
        _log("UNLOAD START", f"Unloading {model_name}", model=model_name)
        _vram_snapshot("before-unload")

        import torch

        # 1. Delete pipeline and all component references
        if self.pipe is not None:
            # Explicitly delete components
            if hasattr(self.pipe, 'unet'):
                del self.pipe.unet
            if hasattr(self.pipe, 'vae'):
                del self.pipe.vae
            if hasattr(self.pipe, 'text_encoder'):
                del self.pipe.text_encoder
            if hasattr(self.pipe, 'tokenizer'):
                del self.pipe.tokenizer
            if hasattr(self.pipe, 'scheduler'):
                del self.pipe.scheduler
            del self.pipe
            self.pipe = None

        # 2. Clear global references
        self.active_model_path = None
        self.active_model_name = None
        self.active_dtype = None

        # 3. Force garbage collection
        gc.collect()

        # 4. Synchronize CUDA
        if torch.cuda.is_available():
            torch.cuda.synchronize()

        # 5. Empty CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        # 6. IPC collect (prevent memory leaks from inter-process data)
        if torch.cuda.is_available():
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass

        vram = _vram_snapshot("after-unload")

        _log("UNLOAD COMPLETE", f"Unloaded {model_name}", model=model_name)
        return {"success": True, "action": "unloaded", "model": model_name, "vram": vram}

    def generate(self, params: dict) -> dict:
        """Generate an image using the currently loaded model."""
        import torch
        import numpy as np

        if not self.is_loaded():
            return {"success": False, "error": "No model loaded. Call load first."}

        gen_id = params.get("generation_id", f"gen-{PID}-{self._generation_count}")
        self._generation_count += 1
        model_name = self.active_model_name

        _log("GENERATE START", f"model={model_name} gen_id={gen_id}", gen_id=gen_id, model=model_name)
        _vram_snapshot("before-generate")

        prompt = params.get("prompt", "")
        negative_prompt = params.get("negative_prompt")
        width = params.get("width", 512)
        height = params.get("height", 512)
        steps = params.get("steps", 10)
        seed = params.get("seed", -1)
        output_path = params.get("output_path", "")

        if not prompt:
            return {"success": False, "error": "No prompt provided"}
        if not output_path:
            return {"success": False, "error": "No output path provided"}

        # Pre-generation VRAM headroom check (PC safety policy).
        # If free VRAM is dangerously low, refuse to start instead of letting
        # Windows start heavy shared-memory swapping.
        if torch.cuda.is_available():
            free_gb = (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated(0)) / (1024**3)
            total_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            # With sequential CPU offload the peak in-flight allocation is one
            # component at a time. Estimate worst case ~0.8 GB.
            REQUIRED_HEADROOM_GB = 0.6
            if free_gb < REQUIRED_HEADROOM_GB:
                _log(
                    "GENERATION ABORT LOW VRAM",
                    f"gen_id={gen_id} free={free_gb:.2f}GB total={total_gb:.1f}GB required>={REQUIRED_HEADROOM_GB}GB",
                    gen_id=gen_id,
                )
                return {
                    "success": False,
                    "error": "Insufficient VRAM headroom",
                    "detail": f"Only {free_gb:.2f} GB free of {total_gb:.1f} GB total. Need at least {REQUIRED_HEADROOM_GB} GB.",
                    "free_vram_gb": round(free_gb, 3),
                    "total_vram_gb": round(total_gb, 3),
                    "action": "Close other GPU applications and try again. Do not generate until sufficient VRAM is free.",
                }

        t_start = time.time()

        generator = None
        if seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(seed)

        gen_kwargs = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_inference_steps": steps,
            "generator": generator,
        }
        if negative_prompt:
            gen_kwargs["negative_prompt"] = negative_prompt

        # Report progress
        def progress_cb(pipe, step, timestep, callback_kwargs):
            pct = round(((step + 1) / steps) * 100)
            _log("PROGRESS", f"step {step+1}/{steps} ({pct}%)", gen_id=gen_id, step=step+1, total=steps, percent=pct)
            return callback_kwargs

        gen_kwargs["callback_on_step_end"] = progress_cb

        try:
            result = self.pipe(**gen_kwargs)
        except RuntimeError as e:
            err_msg = str(e).lower()
            if "out of memory" in err_msg:
                torch.cuda.empty_cache()
                vram = _vram_snapshot("oom")
                _log("GENERATION OOM", f"gen_id={gen_id} {str(e)}", gen_id=gen_id)
                return {
                    "success": False,
                    "error": "CUDA out of memory",
                    "detail": str(e),
                    "vram": vram,
                    "action": "Close other GPU applications, reduce resolution/steps, or unload other models.",
                    "shutdown_reason": "oom",
                }
            raise

        image = result.images[0]
        del result

        # Black image check
        img_array = np.array(image)
        mean_val = float(img_array.mean())
        max_val = int(img_array.max())
        nonblack = mean_val > 1.0 or max_val >= 5

        if not nonblack:
            _log("BLACK IMAGE", f"gen_id={gen_id} mean={mean_val:.2f} max={max_val}", gen_id=gen_id)
            return {"success": False, "error": "Generated image is black", "mean_pixel": round(mean_val, 2), "max_pixel": max_val}

        # Save
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        image.save(output_path, "PNG")

        t_gen = time.time() - t_start
        vram = _vram_snapshot("after-generate")

        _log("GENERATE COMPLETE", f"gen_id={gen_id} time={t_gen:.1f}s", gen_id=gen_id, generation_time_s=round(t_gen, 1))

        return {
            "success": True,
            "path": os.path.abspath(output_path),
            "device": "cuda",
            "gpu": torch.cuda.get_device_name(0),
            "dtype": self.active_dtype,
            "steps": steps,
            "resolution": f"{width}x{height}",
            "generation_time_s": round(t_gen, 1),
            "vram_after_generate_gb": round(vram.get("allocated_vram_gb", 0), 3),
            "mean_pixel": round(mean_val, 2),
            "max_pixel": max_val,
            "pid": PID,
            "gen_id": gen_id,
            "model": model_name,
            "generation_id": params.get("generation_id"),
        }

    def status(self) -> dict:
        """Report current state."""
        import torch
        vram = _vram_snapshot("status")
        return {
            "loaded": self.is_loaded(),
            "model": self.active_model_name,
            "model_path": self.active_model_path,
            "dtype": self.active_dtype,
            "generation_count": self._generation_count,
            "vram": vram,
            "pid": PID,
        }

    def _find_local_config(self, model_path: str) -> str:
        """Find a local Diffusers config directory for single-file models."""
        p = Path(model_path)
        if p.is_file():
            models_dir = p.parent
        else:
            models_dir = p.parent
        for item in models_dir.iterdir():
            if item.is_dir() and (item / "model_index.json").exists():
                return str(item)
        return None

    def _resolve_safetensors(self, dir_path: Path) -> str:
        """Find the primary .safetensors file in a directory."""
        candidates = [f for f in dir_path.iterdir() if f.suffix == '.safetensors' and f.is_file()]
        if not candidates:
            return None
        for f in candidates:
            if 'fp16' in f.name.lower():
                return str(f)
        candidates.sort(key=lambda f: f.stat().st_size, reverse=True)
        return str(candidates[0])


def handle_command(manager: ModelManager, cmd: dict) -> dict:
    """Route a command to the appropriate handler."""
    action = cmd.get("command", "")

    if action == "load":
        model_path = cmd.get("model_path", "")
        if not model_path:
            return {"success": False, "error": "No model_path provided"}
        return manager.load(model_path)

    elif action == "unload":
        return manager.unload()

    elif action == "generate":
        return manager.generate(cmd)

    elif action == "status":
        return manager.status()

    elif action == "validate":
        return validate_model(cmd.get("model_path", ""))

    elif action == "quit":
        reason = cmd.get("reason", "unknown")
        _log("SHUTDOWN", f"reason={reason} caller={cmd.get('caller', 'unknown')}")
        # Unload before quitting
        if manager.is_loaded():
            manager.unload()
        return {"success": True, "action": "quit", "shutdown_reason": reason}

    else:
        return {"success": False, "error": f"Unknown command: {action}"}


def validate_model(model_path: str) -> dict:
    """Validate a model directory or file without loading."""
    p = Path(model_path)
    result = {
        "valid": False,
        "path": str(p),
        "exists": p.exists(),
        "format": None,
        "missing_files": [],
    }

    if not p.exists():
        result["error"] = f"Path does not exist: {model_path}"
        return result

    if p.is_file() and p.suffix == '.safetensors':
        result["format"] = "single-file"
        result["valid"] = True
        return result

    if not p.is_dir():
        result["error"] = f"Not a file or directory: {model_path}"
        return result

    has_model_index = (p / "model_index.json").exists()
    has_unet_dir = (p / "unet").is_dir()

    if has_model_index and has_unet_dir:
        result["format"] = "diffusers"
        # Check UNet weights
        unet_dir = p / "unet"
        has_fp16 = (unet_dir / "diffusion_pytorch_model.fp16.safetensors").exists()
        has_default = (unet_dir / "diffusion_pytorch_model.safetensors").exists()
        has_bin = (unet_dir / "diffusion_pytorch_model.bin").exists()
        if not has_fp16 and not has_default and not has_bin:
            result["missing_files"].append("unet/ weights")
        else:
            result["unet_variant"] = "fp16" if has_fp16 else ("default" if has_default else "bin")
    else:
        safetensors = [f for f in p.iterdir() if f.suffix == '.safetensors' and f.is_file()]
        if safetensors:
            result["format"] = "safetensors-directory"
            result["valid"] = True
            return result
        else:
            result["error"] = "No model_index.json or .safetensors files found"
            return result

    if not result["missing_files"]:
        result["valid"] = True
    else:
        result["error"] = f"Missing {len(result['missing_files'])} required file(s)"

    return result


def main():
    """Persistent worker loop: read commands from stdin, write responses on stdout."""
    manager = ModelManager()
    _shutdown_reason = {"value": "unknown"}

    # Signal handling — capture exit reason and propagate to logs.
    def sigterm_handler(sig, frame):
        _shutdown_reason["value"] = "user_signal_terminate"
        _log("SHUTDOWN", f"reason=user_signal_terminate signal={sig}")
        if manager.is_loaded():
            manager.unload()
        sys.exit(0)

    def sigint_handler(sig, frame):
        _shutdown_reason["value"] = "user_signal_interrupt"
        _log("SHUTDOWN", f"reason=user_signal_interrupt signal={sig}")
        if manager.is_loaded():
            manager.unload()
        sys.exit(0)

    signal.signal(signal.SIGTERM, sigterm_handler)
    signal.signal(signal.SIGINT, sigint_handler)

    _log("WORKER START", f"PID={PID}")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            _response({"success": False, "error": f"Invalid JSON: {e}"})
            continue

        response = handle_command(manager, cmd)
        _response(response)

        # If quit command, exit cleanly with reason
        if cmd.get("command") == "quit":
            _shutdown_reason["value"] = cmd.get("reason", "quit_command")
            break

    _log("WORKER EXIT", f"PID={PID} reason={_shutdown_reason['value']}")


if __name__ == "__main__":
    main()
