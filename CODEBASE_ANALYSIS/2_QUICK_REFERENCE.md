# SF6 Combo Simulator - Quick Reference

## At-a-Glance Summary

### Architecture Overview
```
┌─ INPUT MANAGER ─────────────────────────────────────────┐
│ Tracks keyboard presses → emits InputEvent               │
└────────────────────┬─────────────────────────────────────┘
                     ↓
        ┌─────────────────────────────┐
        │ COMMAND PARSER              │
        │ Motion detection            │
        │ Returns move ID: "5LP"      │
        └──────────┬──────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │ COMBO ENGINE                 │
        │ Validates connections        │
        │ Calculates damage            │
        │ Returns ComboState           │
        └──────────┬───────────────────┘
                   ↓
        ┌──────────────────────────────┐
        │ RENDERING (main.ts)          │
        │ renderCombo()                │
        │ renderFrameTimeline()        │
        │ Update UI stats              │
        └──────────────────────────────┘
```

---

## File Structure
```
src/
├── main.ts                    ← Main event loop & UI
├── types.ts                   ← All interfaces & types
├── style.css                  ← Styling (CSS variables)
├── engine/
│   ├── combo-engine.ts        ← ComboEngine (core logic) ⭐
│   ├── damage-calculator.ts   ← Damage scaling
│   ├── input-manager.ts       ← Keyboard input
│   ├── command-parser.ts      ← Motion detection
│   └── frame-simulator.ts     ← Game loop at 60fps
└── data/
    ├── alex.ts                ← Character: moves, combos
    └── terry.ts               ← Character: moves, combos
```

---

## Critical Interfaces

### ComboState ⭐ (What you get from engine)
```typescript
{
  hits: ComboHit[]              // Each hit with damage
  totalDamage: number           // Total damage
  hitCount: number              // Total hits
  isValid: boolean              // Currently valid?
  currentScaling: number        // Damage multiplier (0-1)
  endReason: 'active' | 'completed' | 'dropped'
  dropInfo?: string             // Why it dropped
}
```

### MoveData ⭐ (What you pass to engine)
```typescript
{
  id: string                    // "5LP", "236HP" (unique key)
  input: string                 // "5LP", "→ HP" (display)
  name?: string                 // "Standing Light Punch"
  damage: number                // 300
  startup: number               // 4 frames
  active: string                // "3" or "2,5" (multi-hit)
  recovery: number              // 9 frames
  hitAdv: string                // "+5", "KD", etc.
  cancel: string                // "Chn Sp SA" (cancel types)
  hitstun: number               // Opponent stun frames
  category: MoveCategory        // 'normal', 'special', 'super', etc.
  // ... 30+ other properties
}
```

### ComboHit (What's in each hit)
```typescript
{
  move: MoveData
  hitNumber: number             // 1, 2, 3...
  connectionType: 'link' | 'cancel' | 'chain' | ...
  rawDamage: number
  scaledDamage: number
  scalingPercent: number        // 0-100%
  isDriveRush: boolean
}
```

---

## ComboEngine Key Methods

### addMove(move: MoveData)
**Returns:** `{ success, connectionType, message }`

**Logic:**
1. ✅ Check if move connects to previous
2. ✅ Calculate damage with scaling
3. ✅ Update combo state
4. ❌ Return error if it doesn't connect (combo drops)

**Connection Types (checked in order):**
- Cancel (fast special/super)
- Link (wait for full recovery)
- Chain (light→light only)

### reset()
Clear all moves, reset combo state

### getCombo()
Get current ComboState

### tick()
Called every frame—checks if combo timed out (45 frames of no input)

---

## Rendering Functions (in main.ts)

### renderCombo(combo: ComboState)
Updates `#combo-sequence` with move chips:
- Shows connector symbols (>, ~, ,)
- Colors moves valid/invalid
- Updates damage, scaling, hit count

### renderFrameTimeline(combo: ComboState)
Draws canvas at `#frame-timeline`:
- Green bars: startup frames
- Red bars: active frames
- Blue bars: recovery frames
- Shows move labels
- Legend at bottom

---

## DOM Structure for Builder

### Where to add drag elements
```html
<!-- MOVE SELECTOR (new) -->
<section id="builder-panel" class="panel">
  <h2>MOVE SELECT</h2>
  <div id="move-list">
    <!-- Draggable move cards here -->
    <div class="move-card" draggable="true" data-move-id="5LP">
      <span>5LP</span>
      <span class="move-damage">300</span>
    </div>
  </div>
</section>

<!-- COMBO SEQUENCE BUILDER (exists, make interactive) -->
<div id="combo-sequence">
  <!-- Swap for builder-specific version -->
  <!-- Add drag handles, remove buttons -->
</div>
```

---

## CSS Classes to Know

### Already exist (can reuse)
- `.panel` - main section styling
- `.stat` - stat boxes
- `.combo-move` - move chip
- `.combo-move.valid` / `.invalid` - styling

### Need to add for builder
- `.move-card` - draggable move
- `.dragging` - during drag
- `.drag-over` - drop target hover
- `.move-card-remove` - X button
- `.builder-sequence` - interactive combo display

---

## What Reuses Well ✅

| Component | Reusable? | Notes |
|-----------|-----------|-------|
| ComboEngine.addMove() | ✅ | Perfect for builder—validates connections |
| renderFrameTimeline() | ✅ | Just needs ComboState + canvas |
| DamageCalculator | ✅ | Automatic via comboEngine |
| CSS variables | ✅ | Use for drag visual feedback |
| Modal system | ✅ | Can show move picker |
| Character data | ✅ | Moves already loaded |
| ComboState type | ✅ | Structure ready to use |

---

## What Needs New Code ❌

| Component | Why | Effort |
|-----------|-----|--------|
| Drag/drop handlers | Not used yet | Medium |
| Move card UI | New component | Small |
| Drop zone logic | New feature | Medium |
| Builder sequence renderer | Different from current | Medium |
| Mode switcher | Didn't exist | Small |
| Preset save UI | New feature | Small |

---

## Key Numbers to Remember

| Value | Meaning |
|-------|---------|
| 60fps | Frame rate (every 16.667ms) |
| 45 frames | Combo input timeout (~0.75s) |
| 4 frames | SF6 universal input buffer |
| 8 frames | Motion detection delay |
| 16 frames | Charge move threshold |

---

## Performance Notes

- ⚠️ FrameSimulator always runs (even when not needed)
- ⚠️ Canvas redraws on every combo update
- ⚠️ Character data loaded on mode switch
- ✅ ComboEngine is fast (O(n) operations)

---

## Integration Strategy for Combo Builder

### Step 1: Mode Switching
```typescript
// Add to header
<button id="btn-builder">Combo Builder</button>

// In main.ts
let builderMode = false
btnBuilder.addEventListener('click', () => {
  builderMode = !builderMode
  document.getElementById('input-panel').classList.toggle('hidden')
  document.getElementById('builder-panel').classList.toggle('hidden')
  if (builderMode) frameSim.stop()
  else frameSim.start()
})
```

### Step 2: Move Card System
```typescript
// Loop through currentCharData.moves
// Create draggable cards
// Store move reference in data-* attribute
```

### Step 3: Drop Zone
```typescript
// Listen for drop on #combo-sequence
// Call comboEngine.addMove(moveData)
// Re-render combo display
```

### Step 4: Reorder & Delete
```typescript
// Drag within sequence to reorder
// Or use arrow buttons/X button
// Reset combo and re-add moves in new order
```

---

## Testing Tips

1. **Combo validity**: Use `comboEngine.addMove()` directly
2. **Damage**: Check `combo.totalDamage` matches expected
3. **Connections**: Check `combo.hits[i].connectionType`
4. **Canvas**: Zoom in on frame timeline to verify sizing
5. **Drag**: Use browser DevTools to trace events

