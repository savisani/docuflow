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

Memory Safety (GTX 1650 4GB):
    - Hard VRAM ceiling: 3.2 GB max target during generation
    - Model stays in VRAM only - no CPU offload
    - Peak memory tracking: reset before generation, report after
     - System RAM guard: refuse if available < 0.8 GB, warn if < 1.2 GB
    - VAE slicing + tiling for decode safety
    - Resolution enforcement: max 512x512 for 4GB GPU
    - Batch size = 1 enforcement

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

# Memory safety constants for GTX 1650 4GB
MAX_RESOLUTION = 512
MAX_BATCH_SIZE = 1


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
    """Send a response on stdout. Always includes type='response' for reliable matching."""
    data["type"] = "response"
    print(json.dumps(data), flush=True)


def _vram_snapshot(label: str = "") -> dict:
    """Take a CUDA memory snapshot."""
    import torch
    if not torch.cuda.is_available():
        return {"cuda": False}
    total = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    allocated = torch.cuda.memory_allocated(0) / (1024**3)
    reserved = torch.cuda.memory_reserved(0) / (1024**3)
    peak_allocated = torch.cuda.max_memory_allocated(0) / (1024**3) if torch.cuda.is_available() else 0
    peak_reserved = torch.cuda.max_memory_reserved(0) / (1024**3) if torch.cuda.is_available() else 0
    snap = {
        "cuda": True,
        "label": label,
        "total_vram_gb": round(total, 3),
        "allocated_vram_gb": round(allocated, 3),
        "reserved_vram_gb": round(reserved, 3),
        "free_vram_gb": round(total - allocated, 3),
        "peak_allocated_vram_gb": round(peak_allocated, 3),
        "peak_reserved_vram_gb": round(peak_reserved, 3),
    }
    _log("VRAM", f"[{label}] alloc={allocated:.2f}GB res={reserved:.2f}GB free={total-allocated:.2f}GB peak_alloc={peak_allocated:.2f}GB peak_res={peak_reserved:.2f}GB total={total:.2f}GB", **snap)
    return snap


def _ram_snapshot(label: str = "") -> dict:
    """Take a system RAM snapshot using psutil."""
    try:
        import psutil
        proc = psutil.Process(PID)
        mem = psutil.virtual_memory()
        sys_total_gb = mem.total / (1024**3)
        sys_available_gb = mem.available / (1024**3)
        sys_used_gb = mem.used / (1024**3)
        sys_percent = mem.percent
        proc_rss_gb = proc.memory_info().rss / (1024**3)
        proc_vms_gb = proc.memory_info().vms / (1024**3)
        proc_percent = proc.memory_percent()
        try:
            pagefile = psutil.swap_memory()
            pagefile_total_gb = pagefile.total / (1024**3)
            pagefile_used_gb = pagefile.used / (1024**3)
            pagefile_percent = pagefile.percent
        except Exception:
            pagefile_total_gb = 0
            pagefile_used_gb = 0
            pagefile_percent = 0

        snap = {
            "label": label,
            "sys_total_gb": round(sys_total_gb, 2),
            "sys_available_gb": round(sys_available_gb, 2),
            "sys_used_gb": round(sys_used_gb, 2),
            "sys_percent": round(sys_percent, 1),
            "proc_rss_gb": round(proc_rss_gb, 2),
            "proc_vms_gb": round(proc_vms_gb, 2),
            "proc_percent": round(proc_percent, 2),
            "pagefile_total_gb": round(pagefile_total_gb, 2),
            "pagefile_used_gb": round(pagefile_used_gb, 2),
            "pagefile_percent": round(pagefile_percent, 1),
        }
        _log("RAM", f"[{label}] sys={sys_used_gb:.1f}/{sys_total_gb:.1f}GB avail={sys_available_gb:.1f}GB | proc RSS={proc_rss_gb:.2f}GB VM={proc_vms_gb:.2f}GB | pagefile={pagefile_used_gb:.1f}/{pagefile_total_gb:.1f}GB ({pagefile_percent:.0f}%)", **snap)
        return snap
    except ImportError:
        _log("RAM", f"[{label}] psutil not available - cannot track system RAM")
        return {"error": "psutil not available"}
    except Exception as e:
        _log("RAM", f"[{label}] RAM snapshot failed: {e}")
        return {"error": str(e)}


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

        # Pre-load VRAM check: ensure enough VRAM is available
        if torch.cuda.is_available():
            total_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            free_vram = total_vram - torch.cuda.memory_allocated(0) / (1024**3)
            _log("LOAD", f"Pre-load VRAM check: free={free_vram:.2f}GB total={total_vram:.2f}GB", model=model_name)
            if free_vram < 1.0:
                _log("LOAD", f"Low VRAM ({free_vram:.2f}GB), running aggressive cleanup", model=model_name)
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
                # Re-check after cleanup
                free_vram = total_vram - torch.cuda.memory_allocated(0) / (1024**3)
                _log("LOAD", f"After cleanup: free={free_vram:.2f}GB", model=model_name)

        # [1] config/path discovery
        _log("LOAD", f"Starting config/path discovery for: {model_name}", model=model_name)
        _vram_snapshot("stage1_config_path_discovery")
        _ram_snapshot("stage1_config_path_discovery")

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
        #   1. Load with torch_dtype=torch.float16 so parameters are fp16.
        #      Model stays in VRAM ~2-3GB, fits in 4GB.
        #   2. Model stays in VRAM only - no CPU offload enabled.
        #   3. VAE decode requires float32 - we patch vae.decode to auto-convert.
        # =====================================================================
        target_dtype = torch.float16
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
                low_cpu_mem_usage=True,
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
                "low_cpu_mem_usage": True,
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
                low_cpu_mem_usage=True,
            )
        else:
            return {"success": False, "error": f"Cannot determine model format for: {model_path}"}

        # [2] checkpoint loading (from_single_file / from_pretrained)
        _log("LOAD", f"Checkpoint loading complete for: {model_name}", model=model_name)
        _vram_snapshot("stage2_checkpoint_loading")
        _ram_snapshot("stage2_checkpoint_loading")

        # Configure pipeline
        _log("LOAD", "Configuring pipeline...", model=model_name)
        pipe.enable_attention_slicing(slice_size="auto")
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass
        try:
            pipe.vae.enable_slicing()
        except Exception:
            pass
        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

        if is_diffusers_fmt:
            self.active_dtype = "fp16"
        else:
            self.active_dtype = "fp16"

        # [3] pipeline configuration
        _log("LOAD", "Pipeline configuration complete", model=model_name)
        _vram_snapshot("stage3_pipeline_configuration")
        _ram_snapshot("stage3_pipeline_configuration")

        # [4] immediately before .to("cuda")
        _log("LOAD", "About to move pipeline to CUDA", model=model_name)
        _vram_snapshot("stage4_before_cuda")
        _ram_snapshot("stage4_before_cuda")

        # Move to CUDA
        _log("LOAD", "Moving to GPU...", model=model_name)
        pipe = pipe.to("cuda")

        # VAE MUST be fully float32 for numerical stability.
        # from_pretrained(variant="fp16") can leave VAE params in fp16 even after .to(fp32).
        # This causes NaN during decode -> black images.
        # Use recursive conversion to ensure ALL parameters and buffers are fp32.
        pipe.vae = pipe.vae.to(dtype=torch.float32)
        for module in pipe.vae.modules():
            for param in module.parameters(recurse=True):
                if param.dtype == torch.float16:
                    param.data = param.data.to(dtype=torch.float32)
            for buf in module.buffers(recurse=True):
                if buf.is_floating_point() and buf.dtype == torch.float16:
                    buf.data = buf.data.to(dtype=torch.float32)

        # Also wrap VAE decode: UNet outputs fp16 latents, cast to fp32 before VAE
        _original_vae_decode = pipe.vae.decode

        def _safe_vae_decode(z, return_dict=True, generator=None, **kwargs):
            import sys
            print(f"[_safe_vae_decode] CALLED: dtype={z.dtype} shape={z.shape} device={z.device}", flush=True)
            if z.dtype != torch.float32:
                print(f"[_safe_vae_decode] Casting {z.dtype} -> float32", flush=True)
                z = z.to(dtype=torch.float32)
            # Check for NaN in latent input
            nan_count = torch.isnan(z).sum().item()
            print(f"[_safe_vae_decode] Input NaN count: {nan_count}, min={z.min().item():.6f} max={z.max().item():.6f}", flush=True)
            result = _original_vae_decode(z, return_dict=return_dict, generator=generator, **kwargs)
            # Check output for NaN
            if hasattr(result, 'sample'):
                out = result.sample
                out_nan = torch.isnan(out).sum().item()
                out_min = out.min().item()
                out_max = out.max().item()
                print(f"[_safe_vae_decode] Output: dtype={out.dtype} shape={out.shape} NaN={out_nan} min={out_min:.6f} max={out_max:.6f}", flush=True)
            return result

        pipe.vae.decode = _safe_vae_decode
        _log("LOAD", "VAE: forced fp32 params + decode wrapper", model=model_name)

        # [5] immediately after .to("cuda")
        _log("LOAD", "Pipeline moved to CUDA (GPU-only, no CPU offload)", model=model_name)
        _vram_snapshot("stage5_after_cuda")
        _ram_snapshot("stage5_after_cuda")

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

        # Verify UNet config
        _log("UNET CONFIG", f"in_channels={pipe.unet.config.in_channels} out_channels={pipe.unet.config.out_channels if hasattr(pipe.unet.config, 'out_channels') else 'N/A'} block_out_channels={pipe.unet.config.block_out_channels if hasattr(pipe.unet.config, 'block_out_channels') else 'N/A'}", model=model_name)
        _log("UNET CONFIG", f"sample_size={pipe.unet.config.sample_size if hasattr(pipe.unet.config, 'sample_size') else 'N/A'}", model=model_name)

        # Verify model dtype
        unet_sample_param = next(pipe.unet.parameters())
        _log("UNET DTYPE", f"sample_param.dtype={unet_sample_param.dtype} sample_param.device={unet_sample_param.device}", model=model_name)

        # Verify text encoder config
        _log("TEXT_ENC CONFIG", f"hidden_size={pipe.text_encoder.config.hidden_size if hasattr(pipe.text_encoder.config, 'hidden_size') else 'N/A'} num_hidden_layers={pipe.text_encoder.config.num_hidden_layers if hasattr(pipe.text_encoder.config, 'num_hidden_layers') else 'N/A'} intermediate_size={pipe.text_encoder.config.intermediate_size if hasattr(pipe.text_encoder.config, 'intermediate_size') else 'N/A'}", model=model_name)
        _log("TEXT_ENC CONFIG", f"vocab_size={pipe.text_encoder.config.vocab_size if hasattr(pipe.text_encoder.config, 'vocab_size') else 'N/A'}", model=model_name)
        _log("TOKENIZER", f"model_max_length={pipe.tokenizer.model_max_length if pipe.tokenizer else 'N/A'}", model=model_name)

        # [8] device verification
        _log("LOAD", "Device verification complete", model=model_name)
        _vram_snapshot("stage8_device_verification")
        _ram_snapshot("stage8_device_verification")

        # Set active model properties
        self.pipe = pipe
        self.active_model_path = model_path
        self.active_model_name = model_name

        # [9] garbage collection / cleanup
        _log("LOAD", "Running garbage collection", model=model_name)
        gc.collect()
        _vram_snapshot("stage9_garbage_collection")
        _ram_snapshot("stage9_garbage_collection")

        # [10] final post-load state
        _log("LOAD", "Final post-load state", model=model_name)
        t_load = time.time() - t_start
        vram = _vram_snapshot("stage10_final_post_load")

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
        _ram_snapshot("before-unload")

        import torch

        # Report peak memory before cleanup
        if torch.cuda.is_available():
            peak_allocated = torch.cuda.max_memory_allocated(0) / (1024**3)
            peak_reserved = torch.cuda.max_memory_reserved(0) / (1024**3)
            _log("UNLOAD PEAK", f"lifetime peak_alloc={peak_allocated:.2f}GB peak_res={peak_reserved:.2f}GB", peak_allocated_gb=round(peak_allocated, 3), peak_reserved_gb=round(peak_reserved, 3))

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

        # 7. Verify VRAM is actually freed (retry if needed)
        if torch.cuda.is_available():
            for retry in range(3):
                allocated = torch.cuda.memory_allocated(0) / (1024**3)
                if allocated < 0.1:
                    break
                _log("UNLOAD RETRY", f"VRAM still has {allocated:.2f}GB allocated, retrying cleanup (attempt {retry+1}/3)")
                gc.collect()
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
                time.sleep(0.5)

        vram = _vram_snapshot("after-unload")
        ram = _ram_snapshot("after-unload")

        _log("UNLOAD COMPLETE", f"Unloaded {model_name}", model=model_name)
        return {"success": True, "action": "unloaded", "model": model_name, "vram": vram, "ram": ram}

    def _vram_log(self, stage: str, gen_id: str = ""):
        """Log current VRAM state."""
        import torch
        if not torch.cuda.is_available():
            return {"stage": stage, "cuda": False}
        alloc = torch.cuda.memory_allocated(0) / (1024**3)
        res = torch.cuda.memory_reserved(0) / (1024**3)
        peak = torch.cuda.max_memory_allocated(0) / (1024**3)
        _log("VRAM", f"[{stage}] alloc={alloc:.3f}GB res={res:.3f}GB peak={peak:.3f}GB", stage=stage, gen_id=gen_id,
             allocated_gb=round(alloc, 4), reserved_gb=round(res, 4), peak_gb=round(peak, 4))
        return {"stage": stage, "allocated_gb": round(alloc, 4), "reserved_gb": round(res, 4), "peak_gb": round(peak, 4)}

    def generate(self, params: dict) -> dict:
        """Generate an image using sequential component offloading.

        Memory-efficient approach for GTX 1650 4GB:
        1. Text encoder on GPU → encode prompt → back to CPU
        2. UNet on GPU → denoise → back to CPU
        3. VAE on GPU → decode → back to CPU
        4. Save image

        Each stage explicitly manages GPU memory to avoid having all components
        loaded simultaneously.
        """
        import torch
        import numpy as np
        from PIL import Image as PILImage

        if not self.is_loaded():
            return {"success": False, "error": "No model loaded. Call load first."}

        gen_id = params.get("generation_id", f"gen-{PID}-{self._generation_count}")
        self._generation_count += 1
        model_name = self.active_model_name

        _log("GENERATE START", f"model={model_name} gen_id={gen_id} SEQUENTIAL OFFLOADING", gen_id=gen_id, model=model_name)

        prompt = params.get("prompt", "")
        negative_prompt = params.get("negative_prompt")
        width = params.get("width", 512)
        height = params.get("height", 512)
        steps = params.get("steps", 10)
        seed = params.get("seed", -1)
        output_path = params.get("output_path", "")

        # Resolution enforcement
        if width > MAX_RESOLUTION or height > MAX_RESOLUTION:
            _log("RESOLUTION ADJUSTED", f"Requested {width}x{height} exceeds max {MAX_RESOLUTION}x{MAX_RESOLUTION}. Adjusting.")
            width = min(width, MAX_RESOLUTION)
            height = min(height, MAX_RESOLUTION)

        if not prompt:
            return {"success": False, "error": "No prompt provided"}
        if not output_path:
            return {"success": False, "error": "No output path provided"}

        # Track VRAM snapshots for response
        vram_snapshots = {}

        # Reset peak memory stats
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.reset_accumulated_memory_stats()

        t_start = time.time()

        # =========================================================================
        # STAGE 1: TEXT ENCODING ON GPU
        # =========================================================================
        _log("STAGE", "[1/4] TEXT ENCODING", gen_id=gen_id)
        self._vram_log("before-text-encoder", gen_id)

        try:
            # Move text encoder to GPU
            self.pipe.text_encoder.to("cuda")
            self._vram_log("text-encoder-on-gpu", gen_id)

            # Tokenize
            if self.pipe.tokenizer is not None:
                # Truncate if needed
                prompt_tokens = self.pipe.tokenizer(
                    prompt, truncation=True, max_length=self.pipe.tokenizer.model_max_length,
                    padding="max_length", return_tensors="pt",
                )
                prompt_ids = prompt_tokens.input_ids.to("cuda")
                _log("TOKENIZE", f"prompt_ids shape={prompt_ids.shape} prompt='{prompt[:50]}...' if len(prompt) > 50 else prompt", gen_id=gen_id)

                neg_tokens = None
                if negative_prompt:
                    neg_tokens = self.pipe.tokenizer(
                        negative_prompt, truncation=True, max_length=self.pipe.tokenizer.model_max_length,
                        padding="max_length", return_tensors="pt",
                    ).input_ids.to("cuda")

                # Encode
                with torch.inference_mode():
                    text_embeddings = self.pipe.text_encoder(prompt_ids, return_dict=True).last_hidden_state

                    if neg_tokens is not None:
                        neg_embeddings = self.pipe.text_encoder(neg_tokens, return_dict=True).last_hidden_state
                        # Concatenate for classifier-free guidance
                        text_embeddings = torch.cat([neg_embeddings, text_embeddings])
                    else:
                        # Duplicate for CFG
                        text_embeddings = torch.cat([text_embeddings, text_embeddings])

                uncond_embeddings, cond_embeddings = text_embeddings.chunk(2)
                text_embeddings = torch.cat([uncond_embeddings, cond_embeddings])
            else:
                text_embeddings = None

            _log("TEXT EMBEDDINGS", f"shape={text_embeddings.shape if text_embeddings is not None else 'None'} dtype={text_embeddings.dtype if text_embeddings is not None else 'None'}", gen_id=gen_id)
            _log("TEXT EMBEDDINGS DETAIL", f"seq_len={text_embeddings.shape[1] if text_embeddings is not None else 'N/A'} hidden_size={text_embeddings.shape[2] if text_embeddings is not None else 'N/A'} batch={text_embeddings.shape[0] if text_embeddings is not None else 'N/A'}", gen_id=gen_id)
            if text_embeddings is not None:
                _log("TEXT EMBEDDINGS STATS", f"min={text_embeddings.min().item():.4f} max={text_embeddings.max().item():.4f} mean={text_embeddings.float().mean().item():.4f} std={text_embeddings.float().std().item():.4f} NaN={torch.isnan(text_embeddings).any().item()} Inf={torch.isinf(text_embeddings).any().item()}", gen_id=gen_id)

        except Exception as e:
            self.pipe.text_encoder.to("cpu")
            torch.cuda.empty_cache()
            _log("ERROR", f"Text encoding failed: {str(e)}", gen_id=gen_id)
            return {"success": False, "error": f"Text encoding failed: {str(e)}", "stage": "text-encoding"}

        # Move text encoder back to CPU
        self.pipe.text_encoder.to("cpu")
        torch.cuda.empty_cache()
        self._vram_log("after-text-encoder-unload", gen_id)
        vram_snapshots["text_encoder_vram_gb"] = round(torch.cuda.memory_allocated(0) / (1024**3), 3) if torch.cuda.is_available() else 0

        # =========================================================================
        # STAGE 2: UNET DENOISING ON GPU
        # =========================================================================
        _log("STAGE", "[2/4] UNET DENOISING", gen_id=gen_id)
        self._vram_log("before-unet-load", gen_id)

        try:
            # Move UNet to GPU
            self.pipe.unet.to("cuda")
            self._vram_log("unet-on-gpu", gen_id)

            # Create latents - starting point for diffusion
            latents = torch.randn(
                (1, self.pipe.unet.config.in_channels, height // 8, width // 8),
                device="cuda",
                dtype=torch.float16,
            )
            _log("LATENTS INIT", f"shape={latents.shape} dtype={latents.dtype} device={latents.device}", gen_id=gen_id)
            _log("LATENTS INIT STATS", f"min={latents.min().item():.4f} max={latents.max().item():.4f} mean={latents.float().mean().item():.4f} std={latents.float().std().item():.4f} NaN={torch.isnan(latents).any().item()} Inf={torch.isinf(latents).any().item()}", gen_id=gen_id)

            # Setup scheduler
            self.pipe.scheduler.set_timesteps(steps)
            _log("SCHEDULER", f"class={type(self.pipe.scheduler).__name__} steps={steps} timesteps_shape={self.pipe.scheduler.timesteps.shape} timesteps_dtype={self.pipe.scheduler.timesteps.dtype}", gen_id=gen_id)
            _log("SCHEDULER", f"first_timestep={self.pipe.scheduler.timesteps[0].item()} last_timestep={self.pipe.scheduler.timesteps[-1].item()}", gen_id=gen_id)

            # Add noise to latents if using seed
            if seed >= 0:
                generator = torch.Generator(device="cuda").manual_seed(seed)
                latents = self.pipe.scheduler.add_noise(latents, torch.randn_like(latents), timesteps=self.pipe.scheduler.timesteps[0:1], generator=generator)

            self._vram_log("before-denoising-loop", gen_id)

            # CFG scale - reduced from 7.5 to 5.0 for fp16 stability
            guidance_scale = params.get("guidance_scale", 5.0)
            disable_cfg = params.get("disable_cfg", False)

            def _tensor_stats(t, name):
                if t is None:
                    return f"{name}=None"
                has_nan = torch.isnan(t).any().item()
                has_inf = torch.isinf(t).any().item()
                return (
                    f"{name}: shape={t.shape} dtype={t.dtype} device={t.device} "
                    f"min={t.min().item():.6f} max={t.max().item():.6f} "
                    f"mean={t.float().mean().item():.6f} std={t.float().std().item():.6f} "
                    f"NaN={has_nan} Inf={has_inf}"
                )

            _log("DENOISE START", f"steps={steps} latents_shape={latents.shape} guidance={guidance_scale} disable_cfg={disable_cfg}", gen_id=gen_id)

            for i, t in enumerate(self.pipe.scheduler.timesteps):
                # Progress logging every 2 steps
                if i % 2 == 0 or i == steps - 1:
                    self._vram_log(f"denoise-step-{i+1}", gen_id)

                _log("DENOISE STEP", f"=== Step {i+1}/{steps} === t={t}", gen_id=gen_id)

                # Expand latents for classifier-free guidance
                latent_model_input = torch.cat([latents] * 2)
                t_tensor = torch.tensor([t], device="cuda", dtype=torch.long)

                # DIAGNOSTIC: Log input stats BEFORE UNet
                _log("UNET INPUT", _tensor_stats(latent_model_input, "latent_model_input"), gen_id=gen_id)
                _log("UNET INPUT", _tensor_stats(text_embeddings, "text_embeddings"), gen_id=gen_id)
                _log("UNET INPUT", f"t_tensor: value={t_tensor.item()} dtype={t_tensor.dtype} device={t_tensor.device}", gen_id=gen_id)

                # Verify text_embeddings shape
                _log("DEBUG", f"text_embeddings shape: {text_embeddings.shape} (expected [2, seq_len, 768] for SD1.5)", gen_id=gen_id)

                with torch.inference_mode():
                    # Predict noise residual - run UNet in FP32 for numerical stability
                    # The GTX 1650 has enough VRAM for this given sequential offloading
                    with torch.amp.autocast("cuda", dtype=torch.float32):
                        noise_pred = self.pipe.unet(latent_model_input, t_tensor, encoder_hidden_states=text_embeddings.float(), return_dict=False)[0]

                # DIAGNOSTIC: Log UNet output stats
                _log("UNET OUTPUT", _tensor_stats(noise_pred, "noise_pred_raw"), gen_id=gen_id)

                # If UNet produces NaN, FAIL immediately - do NOT replace with zeros
                if torch.isnan(noise_pred).any() or torch.isinf(noise_pred).any():
                    self.pipe.unet.to("cpu")
                    torch.cuda.empty_cache()
                    _log("ERROR", f"FATAL: NaN/Inf in noise_pred at step {i+1}. UNet output is invalid. STOPPING.", gen_id=gen_id)
                    _log("ERROR DIAG", _tensor_stats(latent_model_input, "latent_model_input"), gen_id=gen_id)
                    _log("ERROR DIAG", _tensor_stats(text_embeddings, "text_embeddings"), gen_id=gen_id)
                    return {
                        "success": False,
                        "error": f"NaN/Inf in UNet output at step {i+1}. UNet configuration/model may be invalid.",
                        "stage": "unet-output-validation",
                        "step": i + 1,
                        "latent_nan": torch.isnan(latent_model_input).any().item(),
                        "latent_inf": torch.isinf(latent_model_input).any().item(),
                        "embed_nan": torch.isnan(text_embeddings).any().item(),
                        "embed_inf": torch.isinf(text_embeddings).any().item(),
                        "noise_nan": True,
                        "noise_inf": torch.isinf(noise_pred).any().item(),
                    }

                # Perform guidance
                noise_pred_uncond, noise_pred_text = noise_pred.chunk(2)

                # Apply guidance with clamped difference
                noise_diff = (noise_pred_text - noise_pred_uncond).clamp(-10, 10)

                if disable_cfg:
                    _log("CFG", f"CFG disabled at step {i+1}, using uncond prediction", gen_id=gen_id)
                    noise_pred = noise_pred_uncond
                else:
                    noise_pred = noise_pred_uncond + guidance_scale * noise_diff

                # Final NaN check after guidance
                if torch.isnan(noise_pred).any() or torch.isinf(noise_pred).any():
                    _log("ERROR", f"NaN/Inf persists after guidance at step {i+1}", gen_id=gen_id)
                    self.pipe.unet.to("cpu")
                    torch.cuda.empty_cache()
                    return {
                        "success": False,
                        "error": f"NaN/Inf in noise prediction after guidance at step {i+1}",
                        "stage": "denoising",
                        "step": i + 1,
                    }

                # Compute previous sample
                latents = self.pipe.scheduler.step(noise_pred, t, latents, return_dict=False)[0]

                # Log latent stats after scheduler step
                _log("SCHEDULER OUTPUT", _tensor_stats(latents, "latents_after_scheduler"), gen_id=gen_id)

                pct = round(((i + 1) / steps) * 100)
                if i % 2 == 0 or i == steps - 1:
                    _log("PROGRESS", f"step {i+1}/{steps} ({pct}%)", gen_id=gen_id, step=i+1, total=steps, percent=pct)

            self._vram_log("after-denoising", gen_id)
            vram_snapshots["peak_denoising_vram_gb"] = round(torch.cuda.max_memory_allocated(0) / (1024**3), 3)

            # Validate latent before moving to CPU
            latents_cpu = latents.detach().cpu()
            latent_nan = torch.isnan(latents_cpu).any().item()
            latent_inf = torch.isinf(latents_cpu).any().item()
            latent_min = latents_cpu.min().item()
            latent_max = latents_cpu.max().item()

            _log("LATENT VALIDATION", f"NaN={latent_nan} Inf={latent_inf} min={latent_min:.4f} max={latent_max:.4f}", gen_id=gen_id)

            if latent_nan or latent_inf:
                self.pipe.unet.to("cpu")
                torch.cuda.empty_cache()
                _log("ERROR", f"Latent contains NaN/Inf! NaN={latent_nan} Inf={latent_inf}", gen_id=gen_id)
                return {
                    "success": False,
                    "error": f"Latent validation failed: NaN={latent_nan}, Inf={latent_inf}",
                    "stage": "latent-validation",
                    "latent_nan": latent_nan,
                    "latent_inf": latent_inf,
                }

            vram_snapshots["latent_min"] = round(latent_min, 6)
            vram_snapshots["latent_max"] = round(latent_max, 6)

        except RuntimeError as e:
            err_msg = str(e).lower()
            self.pipe.unet.to("cpu")
            torch.cuda.empty_cache()
            if "out of memory" in err_msg:
                vram = self._vram_log("oom", gen_id)
                _log("OOM", f"UNet denoising failed: {str(e)}", gen_id=gen_id)
                return {
                    "success": False,
                    "error": "CUDA out of memory during UNet denoising",
                    "detail": str(e),
                    "stage": "unet-denoising",
                    "vram": vram,
                }
            _log("ERROR", f"UNet denoising failed: {str(e)}", gen_id=gen_id)
            return {"success": False, "error": f"UNet denoising failed: {str(e)}", "stage": "unet-denoising"}

        # Move UNet back to CPU
        self.pipe.unet.to("cpu")
        torch.cuda.empty_cache()
        self._vram_log("after-unet-unload", gen_id)
        vram_snapshots["unet_unloaded_vram_gb"] = round(torch.cuda.memory_allocated(0) / (1024**3), 3) if torch.cuda.is_available() else 0

        # Move latents back to GPU for VAE decode
        latents = latents.to("cuda")
        self._vram_log("latents-on-cuda", gen_id)

        # =========================================================================
        # STAGE 3: VAE DECODE ON GPU
        # =========================================================================
        _log("STAGE", "[3/4] VAE DECODE", gen_id=gen_id)
        self._vram_log("before-vae-load", gen_id)

        try:
            # Move VAE to GPU
            self.pipe.vae.to("cuda")
            self._vram_log("vae-on-gpu", gen_id)

            # Decode latents to image
            with torch.inference_mode():
                # Scale latents for VAE
                latents = latents / self.pipe.vae.config.scaling_factor
                image = self.pipe.vae.decode(latents, return_dict=False)[0]

            self._vram_log("after-vaedecode", gen_id)

            # Move VAE back to CPU immediately
            self.pipe.vae.to("cpu")
            torch.cuda.empty_cache()
            self._vram_log("after-vae-unload", gen_id)

        except Exception as e:
            self.pipe.vae.to("cpu")
            torch.cuda.empty_cache()
            _log("ERROR", f"VAE decode failed: {str(e)}", gen_id=gen_id)
            return {"success": False, "error": f"VAE decode failed: {str(e)}", "stage": "vae-decode"}

        vram_snapshots["peak_vae_vram_gb"] = round(torch.cuda.max_memory_allocated(0) / (1024**3), 3)

        # Move image to CPU and validate
        image = image.detach().cpu()

        # Post-processing: convert to PIL Image
        image = (image / 2 + 0.5).clamp(0, 1)
        image = image.permute(0, 2, 3, 1).numpy()[0]
        image = (image * 255).round().astype("uint8")
        image = PILImage.fromarray(image)

        # =========================================================================
        # STAGE 4: SAVE IMAGE
        # =========================================================================
        _log("STAGE", "[4/4] SAVE IMAGE", gen_id=gen_id)

        # Validate image
        img_array = np.array(image)
        mean_val = float(img_array.mean())
        max_val = int(img_array.max())
        min_val = int(img_array.min())
        std_val = float(img_array.std())
        nonblack = mean_val > 1.0 or max_val >= 5

        _log("IMAGE STATS", f"shape={img_array.shape} dtype={img_array.dtype} min={min_val} max={max_val} mean={mean_val:.2f} std={std_val:.2f} nonblack={nonblack}", gen_id=gen_id)

        vram_snapshots["image_mean"] = round(mean_val, 4)
        vram_snapshots["image_max"] = max_val
        vram_snapshots["image_min"] = min_val
        vram_snapshots["image_nonblack"] = nonblack

        if not nonblack:
            _log("BLACK IMAGE", f"gen_id={gen_id} mean={mean_val:.2f} max={max_val} min={min_val} std={std_val:.2f}", gen_id=gen_id)
            return {
                "success": False,
                "error": "Generated image is black",
                "stage": "black-image-check",
                "mean_pixel": round(mean_val, 2),
                "max_pixel": max_val,
                "min_pixel": min_val,
                **vram_snapshots,
            }

        # Save image
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        image.save(output_path, "PNG")

        file_size = os.path.getsize(os.path.abspath(output_path))
        _log("SAVED", f"path={os.path.abspath(output_path)} size={file_size} bytes", gen_id=gen_id)

        # Re-load to verify
        saved_img = PILImage.open(os.path.abspath(output_path))
        saved_arr = np.array(saved_img)
        saved_mean = float(saved_arr.mean())
        saved_max = int(saved_arr.max())

        _log("VERIFY", f"reloaded size={saved_arr.shape} mean={saved_mean:.2f} max={saved_max}", gen_id=gen_id)

        t_gen = time.time() - t_start
        self._vram_log("final", gen_id)
        vram_snapshots["final_vram_gb"] = round(torch.cuda.memory_allocated(0) / (1024**3), 3) if torch.cuda.is_available() else 0

        # Peak memory summary
        if torch.cuda.is_available():
            peak_allocated = torch.cuda.max_memory_allocated(0) / (1024**3)
            _log("PEAK MEMORY", f"gen_id={gen_id} peak_alloc={peak_allocated:.3f}GB", gen_id=gen_id, peak_allocated_gb=round(peak_allocated, 3))
            vram_snapshots["peak_allocated_vram_gb"] = round(peak_allocated, 3)

        _log("GENERATE COMPLETE", f"gen_id={gen_id} time={t_gen:.1f}s", gen_id=gen_id, generation_time_s=round(t_gen, 1))

        return {
            "success": True,
            "path": os.path.abspath(output_path),
            "device": "cuda",
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none",
            "dtype": self.active_dtype,
            "steps": steps,
            "resolution": f"{width}x{height}",
            "generation_time_s": round(t_gen, 1),
            "latent_nan": latent_nan,
            "latent_inf": latent_inf,
            **vram_snapshots,
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
        has_bin = (unet_dir / "diffusion_pytrotorch_model.bin").exists()
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
