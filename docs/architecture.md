# DocuFlow Architecture

## Overview

DocuFlow is a browser-based video editor built as an Electron desktop application. It allows users to create video projects by composing commands (show, scale, rotate, etc.) with AI-generated or manually imported assets.

## Technology Stack

- **Frontend**: React 19, TypeScript, TailwindCSS
- **State Management**: Zustand
- **Electron**: electron-vite, contextIsolation enabled
- **Rendering**: Remotion for video preview
- **AI Providers**: Ollama (local), Gemini (cloud), Cloudflare (cloud), Local Diffusion (Python)
- **Validation**: Zod schemas
- **Testing**: Vitest

## Directory Structure

```
src/
├── main/                    # Electron main process (Node.js)
│   ├── index.ts           # Entry point, window creation, IPC registration
│   ├── modelManager.ts    # Python subprocess for local AI models
│   └── services/
│       └── projectFolder.ts # Documents/DocuFlow Projects path management
├── preload/                # Secure context bridge
│   ├── index.ts          # IPC invoke wrappers
│   └── index.d.ts       # TypeScript declarations for window.docuflow API
├── renderer/             # React frontend
│   └── src/
│       ├── App.tsx       # Root component, keyboard shortcuts, drag-drop
│       ├── app/
│       │   └── store.ts  # Zustand global state (SOT)
│       ├── components/   # UI components
│       ├── engine/        # Business logic
│       ├── services/      # External integrations
│       ├── schemas/       # Zod validation
│       └── types/         # TypeScript interfaces
└── core/                  # Shared (renderer + main)
    ├── errors/           # Error handling
    ├── jobs/             # Background job management
    └── project/          # Project serialization/migration
```

## Core State (store.ts)

The Zustand store is the single source of truth. Key state:

```typescript
interface DocuFlowState {
  project: Project | null;
  assets: Asset[];
  commands: Command[];
  timeline: TimelineState | null;
  settings: ProjectSettings;
  voiceover: ProjectVoiceover | null;
  transcript: ProjectTranscript | null;
  sceneMarkers: ProjectSceneMarker[];
  projectPath: string | null;    // Absolute path to .docuflow.json
  isDirty: boolean;              // True after modifications
  saveStatus: 'saved' | 'unsaved' | 'saving' | 'save-failed';
  // ... UI state, AI state, history
}
```

## Data Flows

### Project Save Flow

```
User clicks Save
  ↓
store.saveProject() [if no projectPath → saveAsProject()]
  ↓
IPC: dialog.showSaveProjectDialog() [Save As only]
  ↓
IPC: project.saveToPath(filePath, projectData)
  ↓
Main process: writeFileSync(filePath, JSON.stringify(projectData))
  ↓
store.saveStatus = 'saved', isDirty = false
```

### Project Open Flow

```
User clicks Open
  ↓
store.openProjectFromDialog()
  ↓
IPC: dialog.showOpenProjectDialog()
  ↓
IPC: project.loadFromPath(filePath)
  ↓
Main process: readFileSync → JSON.parse
  ↓
migrateProject(data) [if needed]
  ↓
Zod validation with ProjectSchema
  ↓
Reconstruct Asset URLs from filePaths
  ↓
store = { projectPath, assets, commands, settings, voiceover, timeline, saveStatus='saved', isDirty=false }
```

### Asset Import Flow

```
User drags files onto app
  ↓
App.tsx handleDrop()
  ↓
IPC: assets.copyDropped(projectName, filePaths) [if docuflow available]
  ↓
Main: copyFile to Documents/DocuFlow Projects/{project}/assets/
  ↓
Asset URL = filePathToAssetUrl(copiedPath)
  ↓
store.addAsset(asset) → isDirty=true, saveStatus='unsaved'
```

### Timeline Build Flow

```
User modifies commands/assets/voiceover
  ↓
store mutation (addCommand, updateAsset, setVoiceover, etc.)
  ↓
buildTimeline(commands, assets, settings, voiceoverDuration)
  ↓
Timeline resolver maps logicalIds → actual Asset objects
  ↓
store.timeline = resolved TimelineState
  ↓
Remotion re-renders preview
```

### Scene Generator Flow (PROTECTED)

```
User enters natural language description
  ↓
SceneDSL parser → compile(intent) → Command[]
  ↓
store.replaceCommands(parsedCommands)
  ↓
Assets resolved/generated separately
  ↓
Timeline rebuilt
  ↓
User triggers Build to finalize
```

## Key Modules

### Engine

| Module | Purpose |
|--------|---------|
| `commands/types.ts` | Command type definitions (show, scale, rotate, replace, sfx, etc.) |
| `commands/validator.ts` | Validates commands against assets |
| `commands/dsl/parser.ts` | Parses DSL text to Command[] |
| `timeline/builder.ts` | Builds TimelineState from commands |
| `timeline/resolver.ts` | Resolves logicalIds to Asset objects |
| `transcription/service.ts` | Audio transcription orchestration |
| `transcription/localProvider.ts` | Whisper-based local transcription |
| `media/loader.ts` | Loads asset metadata (dimensions, duration) |
| `sceneDSL/compiler.ts` | Compiles scene intent to commands |

### Services

| Service | Provider | Purpose |
|---------|----------|---------|
| `aiService.ts` | Ollama | Local LLM for chat/completion |
| `geminiApi.ts` | Google Gemini | Cloud LLM (PROTECTED) |
| `imageGenerationService.ts` | Cloudflare | AI image generation (PROTECTED) |
| `localImageProvider.ts` | Local Diffusion | Python subprocess image gen |
| `localModelManager.ts` | Model registry | GPU VRAM management |

### IPC Handlers (main/index.ts)

| Handler | Purpose |
|---------|---------|
| `window:minimize/maximize/close` | Window controls |
| `dialog:saveProject/openProject` | Native file dialogs |
| `project:saveToPath/loadFromPath` | File I/O |
| `assets:import/copyDropped` | Asset file management |
| `image:generate-local-enhanced` | Local diffusion |
| `model:unload/switch/status` | GPU model management |
| `transcribe-audio` | Whisper transcription |

## Project File Format (.docuflow.json)

```json
{
  "version": 1,
  "settings": { "width": 1920, "height": 1080, "fps": 30 },
  "assets": [
    {
      "id": "uuid",
      "logicalId": "image1",
      "filename": "photo.jpg",
      "type": "image",
      "mimeType": "image/jpeg",
      "filePath": "C:/Users/.../photo.jpg",
      "width": 1920,
      "height": 1080
    }
  ],
  "commands": [
    { "id": "cmd1", "type": "show", "asset": "image1", "start": 0, "duration": 5 }
  ],
  "voiceover": { "assetId": "uuid", "language": "en" },
  "transcript": { "language": "en", "text": "...", "segments": [] },
  "sceneMarkers": []
}
```

## Protected Systems

The following are architectural invariants that must NOT be changed:

1. **Scene Generator** (`components/generator/SceneGenerator.tsx`) - Generates commands from intent
2. **Gemini API** (`utils/geminiApi.ts`) - Cloud LLM integration
3. **Timeline Builder** (`engine/timeline/`) - Builds timeline from commands
4. **AI Image Generation** (`services/imageGenerationService.ts`) - Cloud image gen
5. **Remotion** (`remotion/`) - Video preview rendering

These are protected because:
- They involve complex external integrations
- Changes can break existing user projects
- They follow specific architectural patterns

## Error Handling

Errors are normalized through `core/errors/normalize.ts` and serialized via `DocuFlowError.toSerializable()`. The store tracks `error` and `errorHistory` state.

## Testing

- `npm test` runs Vitest
- Unit tests co-located with source (`*.test.ts`)
- Key test coverage: schemas, timeline builder, command parser, migrations, job manager
