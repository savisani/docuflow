"""
Local Stable Diffusion image generation script.
Runs entirely offline using Hugging Face Diffusers with memory optimizations for 4GB VRAM.

Usage:
    python scripts/generate_local.py --prompt "a cat in space" --output_path ./output.png --width 512 --height 512

Output (stdout):
    {"success": true, "path": "C:/absolute/path/to/output.png"}
"""

import argparse
import json
import sys
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Generate images locally using Stable Diffusion")
    parser.add_argument("--prompt", type=str, required=True, help="Text prompt for image generation")
    parser.add_argument("--output_path", type=str, required=True, help="Output file path for the generated image")
    parser.add_argument("--width", type=int, default=512, help="Image width in pixels (default: 512)")
    parser.add_argument("--height", type=int, default=512, help="Image height in pixels (default: 512)")
    parser.add_argument("--steps", type=int, default=20, help="Inference steps (default: 20)")
    parser.add_argument("--seed", type=int, default=-1, help="Random seed (-1 for random)")
    parser.add_argument("--model_path", type=str, default=None, help="Local path to model (skips download)")
    args = parser.parse_args()

    try:
        print("Loading dependencies...", file=sys.stderr, flush=True)
        import torch
        from diffusers import StableDiffusionPipeline, UniPCMultistepScheduler

        # Use local model path if provided, otherwise use HuggingFace model ID
        model_path = args.model_path or "runwayml/stable-diffusion-v1-5"
        is_local = args.model_path is not None

        print(f"Loading model from {model_path}...", file=sys.stderr, flush=True)
        
        load_kwargs = {
            "torch_dtype": torch.float16,
            "use_safetensors": True,
        }
        
        # Only use variant="fp16" for remote models (local cache may not have it)
        if not is_local:
            load_kwargs["variant"] = "fp16"
        
        pipe = StableDiffusionPipeline.from_pretrained(model_path, **load_kwargs)

        print("Configuring pipeline...", file=sys.stderr, flush=True)
        pipe.enable_model_cpu_offload()
        pipe.enable_attention_slicing()
        pipe.enable_vae_tiling()

        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)

        generator = None
        if args.seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(args.seed)

        print(f"Generating image ({args.width}x{args.height}, {args.steps} steps)...", file=sys.stderr, flush=True)
        result = pipe(
            prompt=args.prompt,
            width=args.width,
            height=args.height,
            num_inference_steps=args.steps,
            generator=generator,
        )

        image = result.images[0]

        output_path = os.path.abspath(os.path.expandvars(args.output_path))
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        image.save(output_path, "PNG")

        print(f"Image saved to {output_path}", file=sys.stderr, flush=True)
        print(json.dumps({"success": True, "path": output_path}))
        sys.exit(0)

    except ImportError as e:
        print(json.dumps({"success": False, "error": f"Missing dependency: {str(e)}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
