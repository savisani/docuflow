# Timeline Editing Specification

> Permanent behavioral contract for DocuFlow's timeline editor.  
> Any future editing mode, feature, or refactor must conform to this spec.

---

## 1. Mental Model

### 1.1 What Is a Timeline?

The timeline is a **horizontal, left-to-right, visual representation of time**.  
Clips are placed on **tracks** (horizontal rows). Tracks are stacked vertically.  
Higher tracks are composited on top of lower tracks (z-order = vertical track order).

### 1.2 Source of Truth

**Commands** are the single source of truth.  
The timeline editor is a **UI layer on top of Commands**.

```
User interaction → Timeline editor → Timeline editing operation → Existing Command system → Project / Remotion / rendering pipeline
```

The timeline **never** stores its own state independently of Commands.  
Every visual clip on the timeline **must** have a corresponding Command (or set of Commands) in the project.

### 1.3 Editing Modes

The timeline supports multiple editing modes. Only **Normal mode** is implemented in P0.  
All other modes are documented for future reference and must NOT be implemented unless they are provably risk-free for P0 stability.

| Mode | Description | Status |
|------|-------------|--------|
| Normal | Default. Drag to move, drag edges to resize. No gap closure. | **P0 — Implement** |
| Ripple | Moving or trimming shifts all downstream clips to close gaps. | P2 — Future |
| Insert | Moving a clip pushes existing clips right to make room. | P2 — Future |
| Overwrite | Moving a clip replaces whatever is in the destination time range. | P2 — Future |

### 1.4 Interaction Model (Normal Mode)

| Action | Behavior |
|--------|----------|
| Click clip | Select clip (deselects all others) |
| Ctrl+Click clip | Toggle selection (add/remove from multi-select) |
| Shift+Click clip | Range select (all clips between anchor and clicked clip) |
| Click empty area | Deselect all |
| Drag clip body | Move clip (horizontal + vertical, snap-aware) |
| Drag clip left edge | Resize from start (trim in-point) |
| Drag clip right edge | Resize from end (trim out-point) |
| Delete/Backspace key | Delete selected clips (lift — leaves gap) |
| Ctrl+D | Duplicate selected clips |
| Ctrl+C / Ctrl+V | Copy/paste selected clips |
| Drag empty area | Marquee selection (rubber band / lasso) |

---

## 2. Clip Identity

### 2.1 Identity Model

Each clip has **two** identifiers:

| Field | Purpose | Scope |
|-------|---------|-------|
| `commandId` | References the underlying Command in the project. Immutable. | Global (project-wide) |
| `clipId` | Unique visual clip identity. Used for selection, dragging, UI state. | Timeline-local |

`commandId` **never changes** once a clip is created.  
`clipId` is stable for the lifetime of the clip on the timeline (regardless of moves, resizes, track changes).

### 2.2 Identity Stability Rules

- Moving a clip to a different track **does not** change its `commandId` or `clipId`.
- Resizing a clip **does not** change its `commandId` or `clipId`.
- Duplicating a clip creates a **new** `commandId` and `clipId` (new Command + new visual clip).
- Deleting a clip removes the visual clip and the corresponding Command.

### 2.3 Multiple Instances

A single asset can appear multiple times on the timeline (each instance is a separate Command with a unique `commandId`).  
Two clips on different tracks can reference the same asset — they are independent clips with independent Commands.

---

## 3. Track Model

### 3.1 Track Types

| Track Type | Content | z-index Relationship |
|------------|---------|----------------------|
| Main | Primary video content | Topmost (highest z-index) |
| Overlay | Text, titles, graphics, PiP | Below main |
| Background | Backgrounds, lower thirds | Bottom (lowest z-index) |

Audio is handled separately (not on z-index tracks). Audio clips have their own track model.

### 3.2 Track Semantics (z-index)

- Main track: `zIndex = 0`
- Overlay tracks: `zIndex > 0` (higher = closer to viewer)
- Background tracks: `zIndex < 0` (lower = behind other content)

**Important**: In DocuFlow's current implementation, lower zIndex = visually on top (inverted from standard NLE convention). The spec follows NLE convention (higher z = on top). The implementation must handle this mapping.

### 3.3 Track Assignment

- Each clip occupies exactly **one** track at a time.
- Moving a clip vertically changes its track (z-index).
- Moving a clip horizontally changes its time position within the same track.
- Clips **cannot** span multiple tracks simultaneously.

### 3.4 Multiple Clips Per Track

- A single track can contain **multiple clips**.
- Clips on the same track can be adjacent (end-to-end) or have gaps between them.
- Clips on the same track can overlap in time (layered on top of each other within the track).

### 3.5 Track Limits

- Tracks are created dynamically when clips are moved to empty vertical positions.
- No hard limit on number of tracks.
- Tracks are removed when empty (except main track, which always exists).

---

## 4. Movement Model

### 4.1 Horizontal Movement (Time)

- Dragging a clip horizontally changes its **start time** (start frame).
- The clip's **duration** is preserved during horizontal movement.
- The clip can be moved to **any** time position (subject to snapping).
- The clip can be moved **off the left edge** (negative start time) — the UI should clamp or reject this.
- The clip can be moved **past the end** of the timeline — the timeline should extend to accommodate.

### 4.2 Vertical Movement (Track/z-index)

- Dragging a clip vertically changes its **track** (z-index).
- The clip can be moved between **any** two tracks.
- Moving a clip from main to overlay or background is allowed.
- The clip's **time position** (horizontal) is preserved during vertical movement.
- The clip's **duration** is preserved during vertical movement.

### 4.3 Combined Movement

- Horizontal and vertical movement happen **simultaneously** during a single drag operation.
- The clip follows the mouse cursor in both axes.

### 4.4 Movement Constraints (Normal Mode)

- In Normal mode, moving a clip **does not** affect any other clip.
- No automatic gap closure.
- No automatic push/insert.
- Clips can overlap (the topmost clip wins visually).

### 4.5 Drag Threshold

- A drag operation begins only after the mouse has moved **at least 3 pixels** from the initial click position.
- This prevents accidental drags during clicks.

### 4.6 Pointer/Coordinate Handling

- All drag coordinates are computed relative to the **timeline viewport** (not the document).
- The timeline can be scrolled/panned — drag coordinates must account for scroll offset.
- The timeline can be zoomed — drag coordinates must account for zoom level.
- Drag operations must work correctly at any zoom level.

---

## 5. Resize / Trim Model

### 5.1 Resize Handles

- Each clip has a **left handle** (in-point) and a **right handle** (out-point).
- Dragging the left handle changes the clip's **start time** (trim in).
- Dragging the right handle changes the clip's **end time** (trim out).
- The clip's **duration** changes during resize.

### 5.2 Resize Constraints (Normal Mode)

- In Normal mode, resize **cannot** make the clip shorter than **1 frame**.
- In Normal mode, resize **cannot** make the clip longer than the **source media duration** (if applicable).
- In Normal mode, resize **can** overlap adjacent clips (no collision prevention).
- In Normal mode, resize **does not** affect any other clip.

### 5.3 Resize from Left (In-Point)

- Dragging the left handle rightward **shortens** the clip from the start.
- Dragging the left handle leftward **lengthens** the clip from the start.
- The clip's **right edge** (end time) remains fixed.
- The clip's **start time** changes.

### 5.4 Resize from Right (Out-Point)

- Dragging the right handle leftward **shortens** the clip from the end.
- Dragging the right handle rightward **lengthens** the clip from the end.
- The clip's **left edge** (start time) remains fixed.
- The clip's **end time** changes.

### 5.5 Resize State Synchronization

- During resize, the UI updates the clip's visual width in **real time**.
- On mouse up, the resize is committed to the Command system.
- Even if the mouse moves < 1 pixel, the final state **must** be committed on mouse up.

---

## 6. Selection Model

### 6.1 Single Selection

- Clicking a clip selects it and deselects all other clips.
- Only one clip can be selected at a time **without modifier keys**.

### 6.2 Multi-Selection (Modifier Keys)

| Modifier | Action |
|----------|--------|
| Ctrl+Click | Toggle selection (add/remove clip from selection) |
| Shift+Click | Range select (select all clips between anchor and clicked clip) |
| Click empty area | Deselect all |

### 6.3 Marquee Selection (Rubber Band)

- Dragging from an empty area creates a **selection rectangle** (marquee).
- All clips that **intersect** the marquee are selected.
- Dragging left-to-right: clips **enclosed** by the marquee are selected.
- Dragging right-to-left: clips **touched** by the marquee are selected.

### 6.4 Selection State

- Selected clips are visually highlighted (border, color change, handles).
- Selection state is stored in the timeline UI layer (not in Commands).
- Selection is cleared when: clicking empty area, pressing Escape, starting a new drag, etc.

### 6.5 Selection Persistence

- Selection persists across track changes (if the selected clip is moved vertically).
- Selection is cleared on undo only if the selected clip no longer exists.

---

## 7. Snapping Model

### 7.1 Snap Points

The timeline snaps to the following points:

| Snap Point | Description |
|------------|-------------|
| Clip edges | Start and end of all clips on all tracks |
| Playhead | Current playback position |
| Markers | User-defined markers |
| Frame boundaries | Quantize to nearest frame (if enabled) |

### 7.2 Snap Behavior

- Snapping is **enabled** by default.
- Snapping can be toggled via a toolbar button or keyboard shortcut.
- During drag/resize, the clip "jumps" to the nearest snap point when within **snap distance** (default: ~10 pixels).
- A **vertical guideline** appears across all tracks when snapping.
- Snapping affects both horizontal (time) and vertical (track) movement.

### 7.3 Snap Override

- Holding **Shift** during drag **temporarily disables** snapping.
- Holding **Ctrl** during drag **temporarily enables** snapping (if globally disabled).

### 7.4 Snap to Other Tracks

- Clips snap to clip edges on **all tracks** (not just the current track).
- This allows precise alignment of clips across tracks.

---

## 8. Delete / Duplicate / Copy-Paste

### 8.1 Delete (Lift)

- Pressing **Delete** or **Backspace** removes the selected clip(s) from the timeline.
- The corresponding Command(s) are removed from the project.
- A **gap** is left where the clip was (no automatic closure).
- The timeline's total duration may change (if the deleted clip was the last clip).

### 8.2 Ripple Delete (Future — P2)

- **Shift+Delete** performs a ripple delete.
- The clip is removed AND all downstream clips shift left to close the gap.
- This mode is **NOT** implemented in P0.

### 8.3 Duplicate

- **Ctrl+D** duplicates the selected clip(s).
- A new Command is created for each duplicated clip.
- The duplicated clip is placed on the **same track**, offset by a fixed amount (e.g., +1 second or +duration).
- The duplicated clip has a new `commandId` and `clipId`.

### 8.4 Copy/Paste

- **Ctrl+C** copies the selected clip(s) to the clipboard.
- **Ctrl+V** pastes the clipboard contents at the **playhead position**.
- Pasted clips are placed on the **same track** as the original (or on the active track).
- Each pasted clip creates a **new Command**.

### 8.5 Cut

- **Ctrl+X** cuts the selected clip(s) (copies to clipboard + deletes from timeline).
- Same as Copy + Delete.

---

## 9. Empty Timeline Behavior

### 9.1 No Clips State

- When the timeline is empty (no clips), the main track still exists.
- The playhead starts at frame 0.
- The timeline duration is the project's default duration (or 0 if no default).

### 9.2 First Clip Added

- The first clip added to the timeline defines the timeline's minimum duration.
- If the clip starts at frame 0, the timeline duration = clip duration.
- If the clip starts at a later frame, the timeline duration = clip start + clip duration.

### 9.3 Empty Track

- When all clips are removed from a track, the track remains visible (unless it's not the main track).
- Non-main tracks can be removed when empty.

---

## 10. State Synchronization

### 10.1 Timeline → Commands

Every timeline operation **must** result in a corresponding Command system update:

| Timeline Operation | Command System Operation |
|--------------------|--------------------------|
| Add clip | `addCommand` |
| Move clip (time) | `updateCommand` (change `start`) |
| Move clip (track) | `updateCommand` (change `layer` / z-index) |
| Resize clip | `updateCommand` (change `duration`) |
| Delete clip | `removeCommand` |
| Duplicate clip | `addCommand` (new Command) |
| Replace asset | `addCommand` (new Command) or `updateCommand` |

### 10.2 Commands → Timeline

When Commands change (e.g., via undo/redo, scene generator, voiceover), the timeline must rebuild:

```
Commands change → buildTimeline() → TimelineState → Timeline UI updates
```

### 10.3 Atomicity

- Each timeline operation is atomic (single undo step).
- A drag operation = one `updateCommand` call on mouse up.
- A resize operation = one `updateCommand` call on mouse up.

---

## 11. Implementation Boundary

### 11.1 P0 Features (Implement Now)

These features are foundational and must be implemented before any other editing mode:

| Feature | Description |
|---------|-------------|
| Clip selection | Click, Ctrl+Click, Shift+Click, marquee |
| Independent clip identity | `commandId` + `clipId`, identity stability across moves/resizes |
| Horizontal movement | Drag clips left/right in time |
| Vertical movement | Drag clips between tracks (main ↔ overlay ↔ background) |
| Main ↔ other track movement | Clips can move between main and non-main tracks |
| Multiple clips per track | Track can contain multiple clips |
| Clip duration resize | Drag left/right handles to change duration |
| State synchronization | Timeline ops → Command system updates |
| Delete | Lift (leaves gap) |
| Empty timeline behavior | Track exists, playhead at 0, first clip defines duration |
| Drag threshold | 3px minimum before drag begins |
| Pointer/coordinate handling | Correct at any zoom/scroll |

### 11.2 P1 Features (Document, Don't Implement)

These are important but NOT required for foundational stability:

| Feature | Description |
|---------|-------------|
| Snapping | Snap to clip edges, playhead, markers |
| Selection visual feedback | Highlight, border, handles on selected clips |
| Resize visual feedback | Cursor changes, preview of new duration |
| Keyboard shortcuts | Delete, Ctrl+D, Ctrl+C/V, arrow keys |
| Undo/Redo | Already exists in Command system — just wire up keyboard shortcuts |
| Playhead scrubbing | Drag playhead to change current time |

### 11.3 P2 Features (Future — Do NOT Implement)

These are advanced editing modes that require significant architecture work:

| Feature | Description |
|---------|-------------|
| Ripple mode | Move/trim shifts downstream clips |
| Insert mode | Move clip pushes existing clips right |
| Overwrite mode | Move clip replaces destination content |
| Slip edit | Change in/out points without changing duration or position |
| Slide edit | Move clip's position without changing its in/out points |
| Roll edit | Adjust the cut point between two adjacent clips |
| Track locking | Prevent edits on specific tracks |
| Track muting | Mute audio/video on specific tracks |
| Transitions | Cross-dissolve, wipe, etc. between clips |

---

## 12. Reference Implementations

### 12.1 Adobe Premiere Pro

- Click to select, Shift+Click for multi-select, Ctrl+Click for toggle
- Marquee selection (rubber band)
- Drag to move, drag edges to trim
- Delete = lift (leaves gap), Shift+Delete = ripple delete
- Snapping to clip edges, playhead, markers
- Multiple tracks, z-order compositing

### 12.2 DaVinci Resolve

- Normal, Insert, Overwrite, Replace editing modes
- Click to select, Ctrl+Click for multi-select, Shift+LMB for marquee
- Drag to move, drag edges to trim
- Ripple Delete (removes gap), Lift (leaves gap)
- Snapping to clip edges, playhead, markers
- Multiple video/audio tracks

### 12.3 Final Cut Pro

- Magnetic Timeline (primary storyline)
- Click to select, Shift+Click for range, Ctrl+Click for toggle
- Drag to move (magnetic snap on primary storyline)
- Delete = ripple (closes gap), Shift+Delete = replace with gap (lift)
- Snapping to clip edges, playhead, markers
- Connected clips on secondary storylines

### 12.4 Kdenlive

- Click to select, Ctrl+Click for multi-select, Shift+LMB for marquee
- Drag to move, drag edges to trim
- Delete = lift, Shift+Delete = ripple delete
- Snapping to clip edges, playhead, markers
- Multiple video/audio tracks

---

## 13. Implementation Audit

### 13.1 P0 Feature Audit

| Feature | Expected (Spec) | Current | Status | Required Change |
|---------|-----------------|---------|--------|-----------------|
| Clip selection (click) | Click selects, deselects others | ✅ Implemented | PASS | None |
| Clip selection (Ctrl+Click) | Toggle multi-select | ✅ Implemented | PASS | None |
| Clip selection (Shift+Click) | Range select | ❌ Not implemented | MISSING | Add range select logic |
| Marquee selection | Rubber band selection | ✅ Implemented | PASS | None |
| Independent clip identity | `commandId` + `clipId` | ⚠️ Only `commandId` used | PARTIAL | Add `clipId` field |
| Horizontal movement | Drag clips left/right | ✅ Implemented | PASS | None |
| Vertical movement | Drag clips between tracks | ✅ Implemented | PASS | None |
| Main ↔ other track movement | Clips can move between tracks | ✅ Implemented | PASS | None |
| Multiple clips per track | Track can contain multiple clips | ✅ Implemented | PASS | None |
| Clip duration resize | Drag left/right handles | ✅ Implemented | PASS | None |
| State synchronization | Timeline ops → Command system | ✅ Implemented | PASS | None |
| Delete (lift) | Remove clip, leave gap | ✅ Implemented | PASS | None |
| Empty timeline behavior | Track exists, playhead at 0 | ✅ Implemented | PASS | None |
| Drag threshold | 3px minimum | ✅ Implemented (3px) | PASS | None |
| Pointer/coordinate handling | Correct at any zoom/scroll | ✅ Implemented | PASS | None |

### 13.2 P1 Feature Audit

| Feature | Expected (Spec) | Current | Status | Required Change |
|---------|-----------------|---------|--------|-----------------|
| Snapping | Snap to clip edges, playhead | ✅ Implemented | PASS | None |
| Selection visual feedback | Highlight, border, handles | ✅ Implemented | PASS | None |
| Resize visual feedback | Cursor changes, preview | ✅ Implemented | PASS | None |
| Keyboard shortcuts | Delete, Ctrl+D, Ctrl+C/V | ✅ Implemented | PASS | None |
| Undo/Redo | Wire up keyboard shortcuts | ✅ Implemented | PASS | None |
| Playhead scrubbing | Drag playhead | ✅ Implemented | PASS | None |

### 13.3 P2 Feature Audit

| Feature | Expected (Spec) | Current | Status | Required Change |
|---------|-----------------|---------|--------|-----------------|
| Ripple mode | Move/trim shifts downstream clips | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Insert mode | Move clip pushes existing clips | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Overwrite mode | Move clip replaces destination | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Slip edit | Change in/out without changing duration | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Slide edit | Move position without changing in/out | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Roll edit | Adjust cut point between clips | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Track locking | Prevent edits on specific tracks | ❌ Not implemented | NOT REQUIRED | None (P2) |
| Track muting | Mute audio/video on tracks | ❌ Not implemented | NOT REQUIRED | None (P2) |

### 13.4 Deviations from Spec

1. **Overlap handling during drag**: Current implementation auto-removes/modifies overlapping clips on the same track. Spec says Normal mode should allow overlaps without collision prevention. This is a **deviation** that may need attention.

2. **Clip identity**: Current implementation uses `commandId` as the clip identifier. Spec defines separate `commandId` (immutable) and `clipId` (timeline-local). This is a **minor deviation** - current approach is simpler but less flexible for future features.

3. **Shift+Click range select**: Not implemented. Spec requires this for multi-selection.

---

## 14. Glossary

| Term | Definition |
|------|------------|
| Clip | A visual representation of a Command on the timeline |
| Track | A horizontal row that holds clips (z-index layer) |
| Command | The underlying data structure that defines what happens at a point in time |
| z-index | The vertical stacking order of tracks (higher = on top) |
| In-point | The start time of a clip (left edge) |
| Out-point | The end time of a clip (right edge) |
| Duration | The length of a clip (out-point - in-point) |
| Lift | Delete a clip but leave a gap |
| Ripple delete | Delete a clip and close the gap |
| Snap | Magnetic alignment to clip edges, playhead, or markers |
| Marquee | A selection rectangle drawn by dragging on empty area |
| Selection | The set of currently selected clips |
| Anchor | The first clip in a multi-selection (used for range select) |

| Term | Definition |
|------|------------|
| Clip | A visual representation of a Command on the timeline |
| Track | A horizontal row that holds clips (z-index layer) |
| Command | The underlying data structure that defines what happens at a point in time |
| z-index | The vertical stacking order of tracks (higher = on top) |
| In-point | The start time of a clip (left edge) |
| Out-point | The end time of a clip (right edge) |
| Duration | The length of a clip (out-point - in-point) |
| Lift | Delete a clip but leave a gap |
| Ripple delete | Delete a clip and close the gap |
| Snap | Magnetic alignment to clip edges, playhead, or markers |
| Marquee | A selection rectangle drawn by dragging on empty area |
| Selection | The set of currently selected clips |
| Anchor | The first clip in a multi-selection (used for range select) |
