# DocuFlow Desktop

**Browser-based video editor as Electron desktop app** — powered by local AI models, Cloudflare Workers, and Remotion.

## Executive Summary

DocuFlow is an Electron desktop application that lets users build documentary-style videos by combining:
- **Local GPU-accelerated Whisper** for audio transcription
- **Ollama (local LLM)** for AI scene breakdown and storyboard generation
- **Cloudflare Workers (FLUX/SD)** for cloud image generation
- **Local Stable Diffusion** for offline image generation (CUDA/DirectML/CPU)
- **Remotion** for real-time video preview and rendering

### Target Hardware Constraints

| Resource | Constraint |
|----------|-----------|
| VRAM     | 4 GB (target: entry-level dGPU / iGPU) |
| Context Window | `num_ctx: 2048` to stay within VRAM budget |
| Model Keep-Alive | 15 minutes (`keep_alive: "15m"`) |
| Network Timeout | 5 minutes per AI request (300,000 ms) |
| Ollama Server | Localhost:11434, auto-started if offline |

---

## Directory Map

```
docuflow-desktop/
├── electron.vite.config.ts          # Electron-Vite build config (main/preload/renderer)
├── package.json                     # Dependencies & scripts
├── tsconfig.json                    # Root TypeScript config
│
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # Window creation, IPC handlers, asset protocol
│   │   ├── ipc/
│   │   │   └── assets.ts            # Asset copy/resolve IPC
│   │   └── services/
│   │       └── projectFolder.ts     # Project directory management
│   │
│   ├── preload/                     # Electron preload (context bridge)
│   │   ├── index.ts                 # window.docuflow API bridge
│   │   └── index.d.ts              # TypeScript declarations for preload
│   │
│   └── renderer/                    # React frontend (Vite)
│       ├── index.html               # Entry HTML
│       ├── tailwind.config.js       # Tailwind CSS config
│       ├── postcss.config.js        # PostCSS config
│       ├── tsconfig.json            # Renderer TS config
│       └── src/
│           ├── App.tsx              # Root component, tab routing
│           ├── main.tsx             # ReactDOM entry
│           ├── app/
│           │   ├── store.ts         # Zustand global state (undo/redo, assets, commands)
│           │   └── demo.ts          # Demo data
│           ├── components/
│           │   ├── titlebar/        # Custom window title bar
│           │   ├── editor/          # Studio layout (EditorLayout, CommandEditor)
│           │   ├── timeline/        # Timeline track rendering
│           │   ├── preview/         # Asset & video preview panels
│           │   ├── inspector/       # Right-side property inspector
│           │   ├── assets/          # Asset library panel
│           │   ├── commands/        # Command console & results
│           │   ├── voiceover/       # Voiceover panel
│           │   ├── generator/       # AI Scene Generator & Image Generator
│           │   │   ├── SceneGenerator.tsx
│           │   │   ├── ImageGenerator.tsx
│           │   │   └── ThinkingInspector.tsx  # VRAM telemetry + AI reasoning console
│           │   └── ui/              # Reusable primitives (Button, Dialog, Slider, etc.)
│           ├── engine/              # Core logic
│           │   ├── commands/        # DSL parser, validator, NLU parser
│           │   ├── sceneDSL/        # Scene DSL: AI intent → DocuFlow commands
│           │   │   ├── types.ts     # SceneDSL types, motion/transition/style enums
│           │   │   ├── parser.ts    # Scene DSL text parser
│           │   │   ├── compiler.ts  # Deterministic compiler → DocuFlow commands
│           │   │   └── index.ts     # Barrel export
│           │   ├── timeline/        # Timeline builder & resolver
│           │   ├── media/           # Asset loader, findAsset
│           │   ├── animation/       # Interpolation, easing
│           │   └── transcription/   # Whisper local provider, auto-register
│           ├── services/
│           │   ├── aiService.ts           # Ollama / OpenRouter / Gemini, Scene DSL prompt, translation
│           │   ├── imageGenerationService.ts  # Shared image gen pipeline (Cloudflare + Local)
│           │   ├── localImageProvider.ts   # Local SD provider (hardware detect, model management)
│           │   └── modelRegistry.ts       # Dynamic model discovery for all providers
│           ├── utils/               # cloudflareApi, geminiApi, format, configStorage
│           ├── types/               # TypeScript types (assets, project, timeline)
│           ├── design/              # Design tokens, global CSS
│           ├── remotion/            # Remotion composition & layers
│           └── hooks/               # Custom React hooks
│
├── scripts/                         # Python scripts (Whisper transcription, SD generation)
│   ├── generate_local.py            # Stable Diffusion local generation
│   ├── transcribe.py                # Whisper transcription
│   └── .venv/                       # Python virtual environment
│
├── image-generator/                 # Cloudflare Worker for FLUX/SD image generation
│   ├── src/index.ts                 # Worker entry point
│   ├── wrangler.jsonc               # Cloudflare Wrangler config
│   └── test/                        # Worker tests
│
├── patches/                         # Patch files for dependencies
│   └── electron-vite+3.1.0.patch
│
├── out/                             # Built output (main, preload, renderer)
└── resources/                       # App icons, resources for packaging
```

---

## Subsystem Status

| Subsystem | Status | Description |
|-----------|--------|-------------|
| **Timeline Studio** | ✅ Active | Multi-track editor with drag-and-drop, undo/redo, command DSL |
| **Scene DSL Pipeline** | ✅ Active | AI generates simple key-value Scene DSL → deterministic compiler → DocuFlow commands. Separates AI intent from execution. 25 motion types, 14 transitions, 7 styles |
| **AI Scene Breakdown Engine** | ✅ Active | Ollama (local) + OpenRouter + Gemini providers, streaming with `<think>` tag extraction, Scene DSL output format |
| **AI Translation** | ✅ Active | Non-English transcripts auto-translated to English for AI visual reasoning, original text preserved |
| **Thinking Inspector / VRAM Telemetry** | ✅ Active | 350px collapsible sidebar with real-time VRAM monitor, live reasoning console, GPU auto-detect, live token streaming, interactive AI chat input |
| **Top VRAM Status Bar** | ✅ Active | Persistent compact bar: active model badge, real-time VRAM usage pill |
| **Interactive AI Chat** | ✅ Active | In-inspector chat input for direct Ollama model interaction, streaming responses, prompt tweaking |
| **AI Image Generator** | ✅ Active | Cloudflare Workers + Local Stable Diffusion, provider selector, batch generation, regeneration workflow |
| **Local GPU Diffusion Model Manager** | ✅ Active | Persistent Python worker (`scripts/model_manager.py`) enforcing GPU exclusivity, sequential CPU offload for 4GB hardware, full VRAM telemetry, idempotent shutdown with reason tags |
| **Local GPU Whisper Transcriber** | ✅ Active | Python-based, supports tiny/base/small/medium/large-v3 |
| **Asset Management** | ✅ Active | Drag-drop import, asset library, protocol-based local file serving |
| **Video Preview (Remotion)** | ✅ Active | Real-time preview with playhead, track visibility toggles |
| **Voiceover Panel** | ✅ Active | Audio role assignment (voiceover, music, SFX, ambient) |
| **Custom Title Bar** | ✅ Active | Frameless window with minimize/maximize/close IPC |
| **Voiceover Transcription** | ✅ Active | Audio-to-text via local Whisper, segment-level timestamps |

---

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (starts Vite dev server + Electron)
npm run dev

# Build for production
npm run build

# Package for distribution
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

---

## AI Provider Configuration

### Ollama (Local, Free)
- Endpoint: `http://localhost:11434`
- Auto-starts Ollama if not running
- Streaming with `stream: true`, `keep_alive: "15m"`, `num_ctx: 2048`
- 5-minute timeout per request (AbortController)
- VRAM monitor polls `/api/ps` every 2s during generation
- **Model offload** button to unload from GPU memory (`keep_alive: 0`)
- **GPU auto-detection** via Ollama's `/api/ps` endpoint
- **Live token streaming** — tokens appear on screen as they arrive
- **Model loading progress bar** — shows when model is loading to GPU
- **Interactive chat** — chat directly with loaded model from inspector sidebar
- **Top VRAM status bar** — persistent model badge, VRAM usage pill
- **GPU unload button** — header action button next to Reset, instantly frees VRAM

### OpenRouter (Cloud, Free tier)
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Supports free models: Llama 3.2, Gemma 2, Mistral 7B

### Gemini (Cloud)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta`
- Structured JSON output via `responseMimeType`

### Local Stable Diffusion (Persistent Model Manager)
- Worker: `scripts/model_manager.py` — long-lived stdin/stdout JSON process, one pipeline on CUDA at any time.
- IPC: `image:generate-local-enhanced`, `model:load|unload|switch|status|begin-batch|end-batch`, `local-models:cancel-generation`.
- **VRAM strategy (GTX 1650 4GB):** every load calls `pipe.enable_sequential_cpu_offload()` after `.to("cuda")`. Components live on CPU and stream to GPU layer-by-layer during forward, so peak VRAM is one component at a time instead of the full pipeline.
- **Dtype strategy:**
  - SD1.5 (Diffusers, has only `.fp16.safetensors` variant files): loaded with `variant="fp16"` + `torch_dtype=torch.float32`. Weights are loaded into fp32 modules. Full fp16 produced NaN/black images on this checkpoint; full fp32 with offload produces valid images at the memory budget.
  - RV6 (single-file `Realistic_Vision_V6.0_NV_B1_fp16.safetensors`): `torch_dtype=torch.float32`. RV6 fp16 weights produce NaN on the GTX 1650, so fp32 is required.
- **VRAM telemetry:** `_vram_snapshot()` is called at `before-load`, `after-load`, `before-unload`, `after-unload`, `before-generate`, `after-generate`, `status`. Every snapshot logs `alloc / reserved / free / total` in GB and is forwarded to the renderer's `[model-manager][VRAM]` stream.
- **Model exclusivity:** the worker holds at most one `StableDiffusionPipeline`. `load()` unloads the previous model first (logged as `action="unload-first"`). A GPU mutex serialises load/generate/unload in `ModelManagerRunner._withGPUMutex`.
- **No startup preload:** `app.whenReady()` only registers IPC handlers; no diffusion model is loaded until the user clicks Generate. The renderer also never auto-loads.
- **Shutdown reasons:** every shutdown call logs `reason=` and `caller=`. Possible reasons: `user`, `app_exit`, `before_quit`, `generation_cancelled`, `oom`, `error`, `worker_exit`. The Python worker logs `SHUTDOWN reason=... signal=...` on SIGTERM/SIGINT and `WORKER EXIT reason=...` on clean exit. Unexpected worker exits are detected (`UNEXPECTED WORKER EXIT`) and pending requests are rejected.
- **Pre-generation headroom check:** `generate()` refuses to start if free VRAM is below 0.6 GB and returns a clear error message instead of letting the GPU OOM and Windows start heavy shared-memory swapping.
- **`unloadAfter` semantics:**
  - Manual Image Generator (`ImageGenerator.handleGenerate`) → `unloadAfter: false`. The loaded model is **reused** for subsequent generations until the user changes model or clicks the GPU unload button.
  - Manual Scene Generator background phase (`imageGenerationService.generateScenePair`) → `unloadAfter: true` when the local provider is selected. Background is generated, saved, unloaded, then RV6 (if user picked a different model) loads for the person phase.
  - Batch mode (`ModelManagerRunner.beginBatch`/`endBatch`) keeps the same model across the batch; `endBatch` unloads.
- **Legacy one-shot loader:** `scripts/generate_local.py` is retained only for the legacy `image:generate-local` IPC path (one-shot process, exits when done). New code uses `model_manager.py`.

---

## Change Ledger

| Date | Change | Files |
|------|--------|-------|
| 2026-09-03 | **Local Diffusion VRAM Lifecycle Fix** — Root cause: `from_pretrained(variant="fp16")` on the local SD1.5 directory was loading fp16 weight files into fp32 module parameters, producing a ~4 GB steady-state VRAM footprint on a 4 GB GPU. Fix: (1) load with `variant="fp16"` + `torch_dtype=torch.float32` so weights land in fp32 modules; (2) **always** call `pipe.enable_sequential_cpu_offload()` so components live on CPU and stream to GPU layer-by-layer. Peak VRAM after load dropped from **4.00 GB → 0.00 GB** on a 4 GB GTX 1650. (3) Added explicit shutdown reasons (`user`/`app_exit`/`generation_cancelled`/`oom`/`worker_exit`/`error`) propagated to both the Python worker and the TS runner; `ModelManagerRunner.shutdown()` is idempotent and rejects in-flight requests on unexpected worker exit. (4) `unloadAfter=undefined` was an ambiguity: the manual `ImageGenerator.handleGenerate` now explicitly passes `unloadAfter: false` (reuse loaded model) and the comment documents the intended lifecycle. Scene-generator background phase still passes `unloadAfter: true` to swap models between background and person. (5) Added a pre-generation VRAM headroom check that fails gracefully below 0.6 GB free instead of OOMing the GPU. Verified runtime: SD1.5 512x512 6-step generation now completes in ~27s producing valid images (mean=141), and switching SD1.5 → RV6 logs `action="unload-first"` and releases VRAM before the next load. | `scripts/model_manager.py`, `src/main/modelManager.ts`, `src/main/index.ts`, `src/renderer/src/components/generator/ImageGenerator.tsx` |
| 2026-09-01 | **Tab Switching Fix** — Changed from conditional rendering (ternary) to CSS `display:contents`/`none` so all three tab components render simultaneously, hidden via CSS. State now persists across tab switches. | `App.tsx`, `store.ts`, `EditorLayout.tsx` |
| 2026-09-01 | **Transcription Progress** — Added `transcriptionStep`, `transcriptionStepLabel`, `transcriptionStartedAt` to Zustand store. Centralized transcription progress state. VoiceoverPanel shows real elapsed time instead of fake percentage. | `store.ts`, `VoiceoverPanel.tsx` |
| 2026-09-01 | **AI Chat Provider Abstraction** — Added `chatWithProvider()` function that works with Ollama, OpenRouter, and Gemini. Chat UI now supports all providers with provider/model selector. | `aiService.ts`, `ThinkingInspector.tsx`, `SceneGenerator.tsx` |
| 2026-09-01 | **Ollama Thinking Error Fix** — Added `modelSupportsThinking()` function to detect which models support the `think` parameter. Only sends `think: true` for models like qwen3/deepseek-r1. Models like gemma3 no longer get 400 errors. | `aiService.ts` |
| 2026-09-01 | **Model Loaded Indicator** — Added poll-based model status indicator in TitleBar showing 🟠/🟢/🔴/⚫ status. Polls Ollama `/api/ps` every 5 seconds. | `TitleBar.tsx`, `store.ts` |
| 2026-09-01 | **Image Regeneration** — Added "Regenerate image" button with refresh icon in hover overlay. Preserves original image until regeneration succeeds. Shows spinning animation during regeneration. | `ImageGenerator.tsx` |
| 2026-09-01 | **AI Chat Project Context** — Added `buildProjectContext()` function that includes scenes, assets, timeline, and transcript in AI chat prompts. Context toggle button in chat UI. | `aiService.ts`, `ThinkingInspector.tsx`, `SceneGenerator.tsx` |
| 2026-09-01 | **Error Handling** — Added provider-specific error messages in `chatWithProvider()`. Errors now include provider name for easier debugging. | `aiService.ts` |
| 2026-09-01 | **Scene DSL Architecture** — Introduced intermediate Scene DSL between AI output and DocuFlow commands. AI now generates simple key-value text blocks (not JSON) with `text`, `visual`, `motion`, `transition`, `style`, `duration`. Deterministic compiler converts DSL to DocuFlow Command[] with proper motion animations (25 types) and transitions (14 types). Parser normalizes aliases. 117 tests passing. | `engine/sceneDSL/types.ts`, `parser.ts`, `compiler.ts`, `index.ts` |
| 2026-09-01 | **Multi-language Transcript Support** — Added `originalText` and `originalLanguage` fields to TranscriptSegment and ProjectTranscriptSegment types. Added `translated` flag to Transcript. Added `translateToEnglish()` function for non-English transcripts. AI prompt sends both original + English translation for visual reasoning. | `engine/transcription/types.ts`, `types/project.ts`, `services/aiService.ts` |
| 2026-09-01 | **SceneGenerator Refactored** — Timeline assembly now uses Scene DSL compiler instead of manual ShowCommand creation. Supports motion animations and transitions in generated timelines. | `components/generator/SceneGenerator.tsx` |
| 2026-09-01 | Removed all progress bar UI (header, VRAM bar, batch generate, inspector), relocated GPU unload button to header action group next to Reset, stripped `generationProgress` state, removed `ProgressIndicator` component | `SceneGenerator.tsx`, `ThinkingInspector.tsx` |
| 2026-09-01 | Added 350px collapsible inspector sidebar, top VRAM status bar (model badge + VRAM pill + unload button), interactive AI chat panel, collapsible reasoning box, `chatWithModel` streaming function | `SceneGenerator.tsx`, `ThinkingInspector.tsx`, `aiService.ts` |
| 2026-09-01 | Fixed flex layout across all tabs: `w-full h-full` on App root, `flex-col` → `flex-row` split on EditorLayout/ImageGenerator, left/right panel sizing on SceneGenerator, fixed right panel resize handle positioning | `App.tsx`, `EditorLayout.tsx`, `ImageGenerator.tsx`, `SceneGenerator.tsx` |
| 2026-09-01 | Added GPU auto-detection, model offload button, live token streaming (`onToken` callback), model loading state callbacks | `src/renderer/src/services/aiService.ts` |
| 2026-09-01 | **Local/Offline Image Generation** — Enhanced `generate_local.py` with progress reporting, model management, hardware detection. Added `imageGenerationService.ts` shared pipeline, `localImageProvider.ts` provider, `modelRegistry.ts` dynamic discovery. Provider selector (Cloud/Local) in ImageGenerator and SceneGenerator. IPC handlers for model list/import/hardware/cancel. | Multiple files |
| 2026-09-01 | **Dynamic Model Discovery** — `modelRegistry.ts` fetches models from Ollama `/api/tags`+`/api/ps`, Gemini known models, OpenRouter API. Inspector ChatTab uses dynamic model list with refresh button. | `services/modelRegistry.ts`, `ThinkingInspector.tsx` |
| 2026-09-01 | **Unified Image Generation Pipeline** — `imageGenerationService.ts` centralizes all image generation for both ImageGenerator and SceneGenerator. Supports Cloudflare and Local providers with progress callbacks. | `services/imageGenerationService.ts`, `ImageGenerator.tsx`, `SceneGenerator.tsx` |
| 2026-09-01 | Rewrote ThinkingInspector: GPU/VRAM monitor with live polling, model offload button, model loading progress bar, live output stream console, thinking console | `src/renderer/src/components/generator/ThinkingInspector.tsx` |
| 2026-09-01 | Wired up `generateScenesStream` with streaming callbacks, added model loading progress bar in header, inspector toggle button, live output state | `src/renderer/src/components/generator/SceneGenerator.tsx` |
| 2026-09-01 | Added streaming Ollama support with `keep_alive`, `num_ctx: 2048`, 5min timeout, `<think>` tag extraction, and `/api/ps` VRAM telemetry | `src/renderer/src/services/aiService.ts` |
| 2026-09-01 | Created ThinkingInspector panel with VRAM monitor, progress indicator, and live AI reasoning console | `src/renderer/src/components/generator/ThinkingInspector.tsx` |
| 2026-09-01 | Fixed Electron window not showing on startup (added `did-finish-load` fallback) | `src/main/index.ts` |
| 2026-09-01 | Initial README.md with full directory map, subsystem status, and change ledger | `README.md` |

---

## Tech Stack

- **Electron** 36.x + **electron-vite** 3.x
- **React** 19.x + **TypeScript** 5.8
- **Tailwind CSS** 3.x
- **Zustand** 5.x (state management with undo/redo)
- **Remotion** 4.x (video rendering)
- **Lucide React** (icons)
- **Playwright** (E2E testing)
