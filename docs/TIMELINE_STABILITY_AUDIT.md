# Timeline Stability Audit Report

## A. Environment

| Item | Status |
|------|--------|
| Playwright available | YES (v1.62.1) |
| Electron automation available | NO (no Playwright Electron config) |
| Existing E2E infrastructure | NO (test.spec.ts exists but targets localhost:5173, no Playwright config) |
| UI tests actually executed | YES (via Playwright browser tools against running dev server) |

**Note**: Real Electron automation was not available. Tests were performed against the Vite dev server at localhost:5173 using Playwright browser tools. This means IPC/native dialog behaviors could not be tested.

---

## B. UI Test Results

| Scenario | Result | Notes |
|----------|--------|-------|
| Selection (click clip) | **PASS** | Pink border appears on selected clip |
| Selection (click empty) | **PASS** | All clips deselected, playhead seeks |
| Click vs drag | **PASS** | Click seeks playhead, drag moves clip |
| Horizontal movement | **FAIL** | **BUG**: All clips disappear from timeline after drag |
| Main → Other track | BLOCKED | Cannot test due to movement bug |
| Other → Main track | BLOCKED | Cannot test due to movement bug |
| Other → Other track | BLOCKED | Cannot test due to movement bug |
| Multiple clips | **PASS** | Three clips render correctly on same track |
| Resize | **FAIL** | **BUG**: All clips disappear from timeline after resize |
| Same asset multiple times | **PASS** | Three instances of "image1.png" render independently |
| Delete | BLOCKED | Cannot test due to movement/resize bugs |
| Undo/Redo | **FAIL** | **BUG**: Undo reverts too many states (undoes asset import) |
| Overlap behavior | **FAIL** | **BUG**: Overlap handling deletes clips instead of allowing overlaps |

---

## C. Specification Compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Clip selection (click) | ✅ COMPLIANT | Pink border appears on selected clip |
| Clip selection (Ctrl+Click) | NOT TESTED | Could not test multi-select |
| Clip selection (Shift+Click) | NOT IMPLEMENTED | Spec requires range select |
| Marquee selection | NOT TESTED | Could not test |
| Independent clip identity | ⚠️ PARTIAL | Uses `commandId` only, not separate `clipId` |
| Horizontal movement | ❌ NON-COMPLIANT | Clips disappear after drag |
| Vertical movement | NOT TESTED | Cannot test due to movement bug |
| Main ↔ other track movement | NOT TESTED | Cannot test due to movement bug |
| Multiple clips per track | ✅ COMPLIANT | Three clips render on same track |
| Clip duration resize | ❌ NON-COMPLIANT | Clips disappear after resize |
| State synchronization | ⚠️ PARTIAL | Commands remain in store but timeline rendering breaks |
| Delete (lift) | NOT TESTED | Cannot test due to bugs |
| Empty timeline behavior | ✅ COMPLIANT | Shows "Empty" when no clips |
| Drag threshold | ⚠️ UNKNOWN | Cannot verify due to bugs |
| Pointer/coordinate handling | ✅ COMPLIANT | Playhead seeking works correctly |
| Snapping | ✅ COMPLIANT | Snap toggle works, snap guide appears |
| Undo/Redo | ❌ NON-COMPLIANT | Undo reverts too many states |

---

## D. Command Architecture

**Status**: The Command system remains the source of truth, but the Timeline UI layer has issues.

**Evidence**:
- Inspector panel shows "Commands (3)" after operations
- Commands persist in store even when timeline shows "Empty"
- Timeline rendering breaks after drag/resize operations
- The `buildTimeline()` function may be producing incorrect output after operations

**Architecture Risk**: The overlap handling logic in `Timeline.tsx` (lines 752-768) appears to be deleting commands when clips overlap, which violates the spec's Normal mode behavior (overlaps should be allowed).

---

## E. Runtime Problems

| Error | Count | Severity |
|-------|-------|----------|
| Connection refused (127.0.0.1:8765) | 1 | Low (expected - model manager not running) |
| Connection refused (localhost:11434) | 3 | Low (expected - Ollama not running) |
| React key warnings | 2 | Low (cosmetic) |

**No new runtime errors were introduced during testing.**

---

## F. Real Bugs

### 1. Confirmed Timeline Bugs

#### Bug 1: Drag/Resize Causes Clip Disappearance
- **Severity**: CRITICAL
- **Reproduction**: Import asset → Add commands → Select clip → Drag or Resize → All clips disappear
- **Root Cause**: Overlap handling logic in `Timeline.tsx` lines 752-768
- **Expected**: Clips should remain visible and movable
- **Actual**: All clips disappear from timeline, track shows "Empty"
- **Code Location**: `src/renderer/src/components/timeline/Timeline.tsx:752-768`

#### Bug 2: Undo Reverts Too Many States
- **Severity**: HIGH
- **Reproduction**: Import asset → Add commands → Perform operation → Undo multiple times → Asset import also undone
- **Root Cause**: Undo/redo stack includes asset import operations
- **Expected**: Undo should only revert the last operation
- **Actual**: Undo reverts multiple operations including asset import
- **Code Location**: `src/renderer/src/app/store.ts` (undo/redo implementation)

### 2. Architectural Risks

#### Risk 1: Overlap Handling Violates Spec
- **Description**: The overlap handling logic deletes/modifies overlapping clips on the same track
- **Spec Requirement**: Normal mode should allow overlaps without collision prevention
- **Impact**: Clips cannot be freely moved or resized

#### Risk 2: Timeline State Out of Sync
- **Description**: After operations, commands remain in store but timeline renders incorrectly
- **Impact**: UI shows "Empty" while Inspector shows commands exist

### 3. Spec Deviations

| Deviation | Spec Requirement | Current Behavior |
|-----------|------------------|------------------|
| Overlap handling | Allow overlaps in Normal mode | Deletes/modifies overlapping clips |
| Clip identity | Separate `commandId` + `clipId` | Uses only `commandId` |
| Range select | Shift+Click for range select | Not implemented |

### 4. Missing Future Features

These are documented in spec but NOT required for P0:
- Ripple mode
- Insert mode
- Overwrite mode
- Slip/Slide/Roll edits
- Track locking/muting

### 5. Test Environment Limitations

| Limitation | Impact |
|------------|--------|
| No Electron automation | Cannot test IPC, native dialogs |
| No Playwright config | Cannot run automated E2E tests |
| AI services not running | Connection refused errors (expected) |

---

## G. Summary

**Critical Finding**: The Timeline has a **critical bug** where drag and resize operations cause all clips to disappear from the timeline. This is caused by the overlap handling logic that deletes/modifying overlapping clips instead of allowing overlaps in Normal mode.

**Recommended Next Steps** (one at a time, after review):
1. Fix the overlap handling logic in `Timeline.tsx` to allow overlaps in Normal mode
2. Fix the undo/redo stack to not include asset import operations
3. Re-test all scenarios after fixes

**Do NOT proceed with P1/P2 features until P0 bugs are fixed.**
