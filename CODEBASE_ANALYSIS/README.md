# SF6 Combo Simulator - Codebase Exploration Results

**Exploration Date:** April 3, 2026  
**Thoroughness Level:** Medium  
**Focus:** Understanding structure for drag-and-drop combo builder mode implementation

---

## 📋 Documentation Files

### 1. **DETAILED_ANALYSIS.md** (Comprehensive Reference)
The main deep-dive document covering all 10 sections:
- HTML layout structure with IDs and classes
- Main.ts initialization flow and input pipeline
- ComboEngine architecture and connection logic
- Frame timeline rendering algorithm
- CSS layout and styling system
- Types and interfaces (MoveData, ComboState, etc.)
- Detailed reusability analysis
- Current pipeline architecture
- Integration points for new mode
- Critical findings and gotchas

**Use when:** You need complete technical reference for implementation

---

### 2. **QUICK_REFERENCE.md** (Quick Lookup Guide)
At-a-glance reference with tables and short summaries:
- Architecture overview diagram
- File structure
- Critical interfaces (ComboState, MoveData, ComboHit)
- ComboEngine key methods
- Rendering functions
- Reusability matrix (✅/❌ ratings)
- Integration strategy template
- Testing tips
- Key numbers to remember

**Use when:** You need to quickly look up a specific component or number

---

### 3. **VISUAL_SUMMARY.txt** (ASCII Diagrams)
Visual representations of architecture:
- Current HTML layout structure (ASCII)
- Data flow architecture diagram
- Connection validation logic flowchart
- Frame timeline rendering visualization
- Reusability matrix table
- Key integration points
- Critical gotchas & solutions table

**Use when:** You want to understand the overall flow visually

---

## 🎯 Key Findings

### ✅ What's Ready to Reuse

| Component | Status | Details |
|-----------|--------|---------|
| **ComboEngine** | ✅ 100% | `addMove()` validates perfectly, just needs MoveData objects |
| **Rendering** | ✅ 100% | `renderCombo()` and `renderFrameTimeline()` work independently |
| **DamageCalculator** | ✅ 100% | Integrated; automatic damage/scaling calculation |
| **CSS/Colors** | ✅ 100% | Fully themeable via CSS variables |
| **Types** | ✅ 100% | ComboState, MoveData, etc. ready to use |
| **Modal System** | ✅ 100% | Can reuse for move picker dialogs |
| **Character Data** | ✅ 100% | 350+ moves per character already loaded |

### ⚠️ What Needs Adaptation

| Component | Issue | Solution |
|-----------|-------|----------|
| **InputManager** | Tied to keyboard | Don't use in builder mode |
| **CommandParser** | Motion detection focused | Reuse only `findMove()` method |
| **FrameSimulator** | Always runs at 60fps | Pause when in builder mode |

### ❌ What Needs New Code

| Component | Why | Effort |
|-----------|-----|--------|
| **Drag/Drop System** | Doesn't exist | Medium |
| **Move Card UI** | New component | Small |
| **Builder Sequence** | Different from read-only display | Medium |
| **Mode Switcher** | New feature | Small |
| **Drop Zone Logic** | New feature | Medium |

---

## 🏗️ Architecture Summary

### Current Data Flow
```
Keyboard Input
    ↓
InputManager (captures keys)
    ↓
CommandParser (detects moves via motion)
    ↓
ComboEngine (validates connections)
    ↓
DamageCalculator (updates damage)
    ↓
Rendering (update UI)
```

### For Combo Builder
```
User Drags Move
    ↓
Drop Event Handler
    ↓
ComboEngine.addMove(move) ← REUSE THIS
    ↓
Rendering (same functions) ← REUSE THESE
    ↓
User sees result
```

---

## 💡 Critical Integration Points

### 1. **Shared State** (Both Modes)
- `currentCharData: CharacterData` - Character and moves
- `comboEngine: ComboEngine` - Validation engine
- `currentCombos: PresetCombo[]` - Preset combos

### 2. **Rendering** (Both Modes)
- `renderCombo(combo)` - Display moves
- `renderFrameTimeline(combo)` - Canvas timeline
- Both reuse existing canvas element

### 3. **Mode-Specific** (Separate)
- Real-time: InputManager, CommandParser, FrameSimulator
- Builder: Drag/drop handlers, move cards, drop zones

---

## 🎮 Core Engine - ComboEngine.addMove()

The heart of combo validation. Input:
```typescript
addMove(move: MoveData)
```

Returns:
```typescript
{
  success: boolean,           // Did it connect?
  connectionType: string,     // 'link' | 'cancel' | 'chain' | ...
  message: string             // Human-readable explanation
}
```

Logic:
1. Check if move connects via **cancel** (priority 1)
2. If not, check **link** (priority 2)
3. If neither → combo drops, start fresh with this move

The builder relies entirely on this function to validate combos.

---

## 📐 HTML Structure for Builder

Current layout: **3-column grid** (260px | 1fr | 300px)

For builder, you can:
- Replace left panel (`#input-panel`) with move selector
- Keep center panel (`#center-panel`) but adjust combo-sequence interactivity
- Keep right panel for presets or statistics

Or add a **mode toggle** in header to switch between views.

---

## 🔑 Key Numbers

| Value | Meaning | Where Used |
|-------|---------|-----------|
| **60fps** | Frame rate | FrameSimulator |
| **45 frames** | Combo timeout (~0.75s) | ComboEngine |
| **4 frames** | Input buffer | SF6 official |
| **8 frames** | Motion detection delay | Delayed motion parsing |
| **16 frames** | Charge threshold | Charge move detection |

---

## ⚡ Performance Notes

- ✅ ComboEngine is fast (O(n) where n = combo length)
- ⚠️ Canvas redraws on every update (unavoidable but acceptable)
- ⚠️ FrameSimulator runs 60fps even when not needed
- ✅ No major bottlenecks for builder mode

---

## 🚀 Next Steps for Implementation

1. **Create Mode Selector**
   - Add button in header to toggle between modes
   - Use `.hidden` class to toggle panels

2. **Build Move Card System**
   - Loop through `currentCharData.moves`
   - Create draggable `<div class="move-card">` elements
   - Store move reference in `data-move-id`

3. **Implement Drag/Drop**
   - `dragstart` → clone element
   - `dragover` → highlight drop zones
   - `drop` → call `comboEngine.addMove(move)`

4. **Reorder/Delete**
   - Drag within sequence to reorder
   - X buttons to remove
   - Reset combo and re-add in new order

5. **Test Integration**
   - Create combo via builder
   - Switch to real-time mode
   - Test if combo plays correctly

---

## 🔍 How to Use These Documents

### For Architecture Understanding
→ Read **VISUAL_SUMMARY.txt** first (ASCII diagrams)

### For Implementation Details
→ Reference **DETAILED_ANALYSIS.md** (sections 1, 3, 4)

### For Quick Lookups
→ Use **QUICK_REFERENCE.md** (tables and code snippets)

### For Code Integration
→ Check **DETAILED_ANALYSIS.md** sections 7, 8, 9

---

## 📝 Notes

- All code is **TypeScript** with strong typing
- **CSS** uses custom properties (easy theming)
- **ComboEngine** is production-ready and well-tested
- Connection logic assumes **opponent always blocks** (fighting game standard)
- No external dependencies beyond TypeScript and standard Web APIs

---

## 🎯 TL;DR

**What you need to build:**
- Drag/drop event handlers
- Move card UI
- Drop zone logic
- Mode switcher

**What you can reuse:**
- ComboEngine.addMove() ← validation
- renderCombo() ← display
- renderFrameTimeline() ← canvas
- DamageCalculator ← automatic
- All CSS variables ← styling
- All types ← data structures

**Estimated effort:**
- Small: ~2-4 hours for basic drag/drop
- Medium: ~6-8 hours with polish and features
- Large: ~12+ hours with advanced features (undo/redo, etc.)

---

Generated: April 3, 2026  
Scope: SF6 Combo Simulator Codebase Exploration
