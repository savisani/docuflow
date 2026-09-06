# DocuFlow AI Development Rules

## Core Principles

### 1. Never Rewrite Working Systems
- Only refactor when there is a clear benefit and the existing implementation is broken or unsalvageable
- When a system works, preserve it even if the implementation is not ideal
- Make the smallest possible change to fix issues

### 2. One Task = One Subsystem
- Each task should be confined to one subsystem (store, service, IPC, UI, etc.)
- Do not mix concerns across subsystems

### 3. Inspect Before Modifying
- Always read the existing code in the relevant subsystem before making changes
- Understand the current data flow before modifying
- Check the test files for existing behavior

### 4. Make Small Changes
- Prefer minimal, targeted edits over broad refactoring
- If a change requires touching many files, reconsider the approach
- Break large changes into smaller, reviewable steps

### 5. Never Fix Unrelated Problems
- If you discover another bug while working, report it but do NOT fix it automatically
- If your requested fix appears to require changing another subsystem, STOP and explain why

### 6. Protected Systems
The following systems must NOT be modified unless explicitly requested by the user:

- **Scene Generator** - `src/renderer/src/components/generator/SceneGenerator.tsx`
- **Gemini API** - `src/renderer/src/utils/geminiApi.ts`
- **Pollination** - any pollination-related code
- **Timeline Generation** - `src/renderer/src/engine/timeline/`
- **AI Image Generation** - `src/renderer/src/services/imageGenerationService.ts`
- **Ollama Integration** - `src/renderer/src/services/aiService.ts`
- **Remotion Rendering** - `src/renderer/src/remotion/`
- **Build/Generate+Build Flow** - anything related to scene building

---

## Project Architecture

### Directory Structure

```
src/
├── main/                    # Electron main process
│   ├── index.ts            # Entry point, IPC handlers, window management
│   ├── modelManager.ts     # Python subprocess management for AI models
│   └── services/
│       └── projectFolder.ts # Project path management
├── preload/
│   ├── index.ts            # Context bridge API
│   └── index.d.ts         # TypeScript declarations
├── renderer/               # React frontend
│   └── src/
│       ├── app/
│       │   └── store.ts   # Zustand global state
│       ├── components/     # React UI components
│       │   ├── titlebar/   # TitleBar, window controls
│       │   ├── editor/     # EditorLayout, CommandEditor
│       │   ├── timeline/   # Timeline visualization
│       │   ├── generator/  # ImageGenerator, SceneGenerator
│       │   ├── assets/    # AssetLibrary
│       │   ├── preview/    # VideoPreview, AssetPreview
│       │   ├── inspector/  # Inspector panel
│       │   ├── voiceover/ # VoiceoverPanel
│       │   └── ui/        # Shared UI primitives
│       ├── engine/         # Business logic
│       │   ├── commands/   # Command types, validation, DSL parser
│       │   ├── timeline/   # Timeline building, resolution
│       │   ├── transcription/ # Audio transcription
│       │   ├── media/     # Asset loading, metadata
│       │   ├── animation/  # Animation interpolation
│       │   └── sceneDSL/   # Scene DSL compiler
│       ├── services/        # External integrations
│       │   ├── aiService.ts # Ollama API
│       │   ├── imageGenerationService.ts # Cloudflare/local images
│       │   └── ai/pipeline/ # Pipeline orchestration
│       └── schemas/         # Zod validation schemas
└── core/                   # Shared utilities
    ├── errors/             # Error handling
    ├── jobs/               # Job management
    └── project/            # Project serialization/migrations
```

### Data Flow

#### Project Save Flow
```
UI (TitleBar Save button)
  → store.saveProject() or store.saveAsProject()
    → IPC: showSaveProjectDialog() / saveProjectToPath()
      → Electron main process (dialog.showSaveDialog)
        → File system write (JSON)
```

#### Project Open Flow
```
UI (TitleBar Open button)
  → store.openProjectFromDialog()
    → IPC: showOpenProjectDialog() / loadProjectFromPath()
      → Electron main process (dialog.showOpenDialog)
        → File system read (JSON)
          → Project migration
            → Zod validation
              → Store update
```

#### Timeline Build Flow
```
User modifies commands/assets/voiceover
  → store mutation (addCommand, updateAsset, setVoiceover, etc.)
    → buildTimeline() called within each mutation
      → Timeline resolved from commands + assets
        → Remotion renders video preview
```

#### Scene Generator Flow (PROTECTED)
```
User inputs natural language description
  → SceneDSL parser compiles to commands
    → Commands added to store
      → Assets resolved/generated
        → Timeline rebuilt
          → User can Build to finalize
```

---

## Save/Open and Project Persistence Rules

### Current Implementation
- **Format**: `.docuflow.json` files
- **Location**: User-selected via native Windows dialog
- **Project Path**: Tracked in `store.projectPath`
- **Dirty State**: `store.isDirty`, `store.saveStatus`

### State Fields
```typescript
projectPath: string | null      // Absolute path to .docuflow.json
isDirty: boolean                 // True after any modification
saveStatus: 'saved' | 'unsaved' | 'saving' | 'save-failed'
```

### Dirty State Tracked In
- `addAsset`, `removeAsset`, `updateAsset`
- `addCommand`, `removeCommand`, `updateCommand`, `replaceCommands`
- `setSettings`, `setVoiceover`, `setTranscript`
- `addSceneMarker`, `removeSceneMarker`, `setSceneMarkers`
- `reorderCommands`, `duplicateCommand`
- `addToTimeline`

### New Project Flow
- `store.newProject()` resets: `projectPath=null`, `isDirty=false`, `saveStatus='unsaved'`

### Save Behavior
- **First Save** (no `projectPath`): Shows native Save As dialog
- **Subsequent Save** (has `projectPath`): Saves directly to existing path
- **Save As**: Always shows native dialog, updates `projectPath`

---

## Asset Identity/Persistence Rules

### Asset Structure
```typescript
interface Asset {
  id: string;           // UUID
  logicalId: string;    // Semantic identifier (e.g., "image1")
  filename: string;     // Original filename
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  filePath: string;     // Absolute path to file
  url: string;          // docuflow-asset:// URL for rendering
  width?: number;
  height?: number;
  duration?: number;
  audioRole?: 'voiceover' | 'music' | 'sfx' | 'ambient' | 'unassigned';
}
```

### Asset URLs
- Files are served via `docuflow-asset://` protocol
- Path conversion: `filePathToAssetUrl()` and `assetUrlToFilePath()`
- Main process handles protocol and streams files

### Persistence
- Assets serialized by `filePath` reference
- On load, URLs reconstructed from `filePath`
- Assets are NOT copied into project - stored by reference

---

## AI Provider Architecture Rules

### Supported Providers
1. **Ollama** (local) - via `aiService.ts`
2. **Gemini** (cloud) - via `geminiApi.ts`
3. **Cloudflare** (cloud) - via `imageGenerationService.ts`
4. **Local Diffusion** - via Python subprocess, `modelManager.ts`

### Local Model Management
- `ModelManagerRunner` spawns Python subprocess
- Handles GPU VRAM management
- Single model loaded at a time
- Model lifecycle: load → generate → unload

### Protected Providers
- Gemini, Pollination, Ollama interfaces must NOT be modified

---

## Scene Generator Generate / Build Rules (PROTECTED)

### Generate Button
- Parses natural language → SceneDSL → commands
- Does NOT generate assets immediately
- Assets added to timeline as references

### Build Button
- Resolves asset references
- Builds final timeline
- Triggers Remotion rendering

### Generate + Build
- Orchestrates full pipeline
- Must NOT be modified

---

## Timeline Timing Rules

### Timeline Building
- `buildTimeline(commands, assets, settings, voiceoverDuration)`
- Called reactively within store mutations
- Derives timing from voiceover duration if present

### Command Resolution
- Commands reference assets by `logicalId`
- Timeline resolver maps `logicalId` → actual `Asset`
- Timing computed from voiceover segments

---

## Electron IPC Rules

### Security Model
- `contextIsolation: true`
- `nodeIntegration: false`
- All IPC via `contextBridge.exposeInMainWorld`

### IPC Categories

#### Window Controls
```typescript
window:minimize, window:maximize, window:close
window:isMaximized → boolean
window:maximized (event)
```

#### Dialogs
```typescript
dialog:selectFolder → { canceled, filePath }
dialog:saveProject → { canceled, filePath }
dialog:openProject → { canceled, filePath }
```

#### Project
```typescript
project:saveToPath(path, data) → { success, error }
project:loadFromPath(path) → { success, data, error }
```

#### Assets
```typescript
assets:import(projectName) → string[]
assets:copyDropped(projectName, paths) → string[]
```

#### Image Generation
```typescript
image:generate-local(params) → { success, path, error }
image:generate-local-enhanced(params) → { success, path, error }
```

#### Model Management
```typescript
model:unload, model:switch, model:status
model:begin-batch, model:end-batch
```

### Native Dialogs
- Must run from main process via `dialog.showSaveDialog` / `dialog.showOpenDialog`
- BrowserWindow reference validated via `BrowserWindow.fromWebContents()`

---

## UI Rules

### Title Bar
- Custom frameless window with `-webkit-app-region: drag`
- Interactive elements use `-webkit-app-region: no-drag`
- Window controls (minimize/maximize/close) run from main process

### Component Organization
- Components are panel-based
- State via Zustand store
- No prop drilling across major sections

### Design System
- Design tokens in `design/tokens.ts`
- CSS variables in `design/global.css`
- Use existing component primitives before custom styles

---

## Git Safety Rules

### DO NOT
- `git push --force`
- `git reset --hard` (unless explicitly requested)
- `git clean -f` (unless explicitly requested)
- Delete commit history
- Amend commits that have been pushed (unless fixing a failed CI)

### DO
- Commit often with clear messages
- Create feature branches for changes
- Review `git diff` before committing
- Keep commits focused on single concerns

---

## Testing Rules

### Run Tests
```bash
npm test    # vitest run
```

### Test Coverage
- Unit tests for: schemas, timeline builder, command parser, migrations
- Integration tests for: workflow machines, job manager
- No E2E tests currently

### Test Location
- `*.test.ts` files co-located with source
- `__tests__/` directories for complex subsystems

---

## After-Task Verification

### Before Completing Any Task
1. Run `npm run build` - must succeed
2. Run `npm test` - all tests must pass
3. Verify no unintended changes: `git diff --name-only`
4. For Save/Open specifically:
   - Test first save shows dialog
   - Test subsequent save does not show dialog
   - Test Save As always shows dialog
   - Test Open restores exact state

### If Verification Fails
- Do NOT commit broken changes
- Fix the issue before completing the task
- Re-verify

---

## Reporting Issues Discovered During Work

If you discover bugs or issues in OTHER subsystems while working:

1. Document the issue clearly
2. Stop work on the original task
3. Report to user
4. Do NOT fix automatically

If your requested fix requires modifying a protected system:
1. Explain why the modification is needed
2. Wait for explicit user approval
3. Make only the minimum necessary change

---

## File Format

- All source files use TypeScript (.ts, .tsx)
- Configuration uses JSON where appropriate
- No new file formats without explicit user request
