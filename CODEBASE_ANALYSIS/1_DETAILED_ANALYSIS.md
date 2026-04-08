# SF6 Combo Simulator - Codebase Analysis
## Medium Thoroughness Exploration for Drag-and-Drop Combo Builder Mode

---

## 1. HTML LAYOUT STRUCTURE (index.html)

### Overall Architecture
- **Flex layout** with `#app` as main container
- **Three-panel grid layout** in main section (260px | 1fr | 300px)
- **Header** with character selection and controls

### Key Panel IDs & Structure:
```
#app
├── #header (character select, settings, movelist, reset buttons)
└── #main (grid: 3 columns)
    ├── #input-panel (left, 260px)
    │   ├── #direction-display (numpad grid)
    │   ├── #button-display (LP/MP/HP and LK/MK/HK rows)
    │   └── #input-history (reversed flex column)
    │
    ├── #center-panel (middle, 1fr)
    │   ├── #combo-sequence (flex wrap, combo moves)
    │   ├── #frame-timeline-container
    │   │   └── #frame-timeline (canvas)
    │   ├── #combo-stats (4 stats: damage, scaling, drive, status)
    │   └── #move-detection
    │
    └── #preset-panel (right, 300px)
        └── #preset-combos (flex column of combos)

#modal-overlay (for settings/movelist)
├── #modal-content
    └── #modal-body
```

### Important Element Classes:
- `.panel` - Main sections with padding, scrollable
- `.dir` / `.game-btn` - Input display elements (can be `.active`)
- `.combo-move` / `.combo-connector` - Combo sequence display
- `.stat` - Individual stat boxes in combo stats
- `.preset-combo` - Preset combo items (can be `.selected`)

### Canvas Elements:
- `#frame-timeline` - Rendered via `renderFrameTimeline()` function

---

## 2. MAIN.TS INITIALIZATION FLOW

### Character Management
```typescript
// Current state
let currentCharacterName = localStorage.getItem('sf6-character') || 'alex'
let currentCharData: CharacterData
let currentCombos: typeof ALEX_COMBOS

// Character loader registry
const CHARACTERS: Record<string, () => Promise<CharacterEntry>> = {
  alex: async () => { import('./data/alex'); return { data, combos } }
  terry: async () => { import('./data/terry'); return { data, combos } }
}

// Engines initialized with first character
const inputManager = new InputManager()
const commandParser = new CommandParser(currentCharData)
const comboEngine = new ComboEngine()
const frameSim = new FrameSimulator()
```

### Character Switching Flow
```typescript
async function switchCharacter(name: string):
  1. Load CHARACTERS[name]()
  2. Update currentCharData, currentCombos
  3. Call commandParser.setCharacter(data)
  4. comboEngine.reset()
  5. Update UI (charNameEl, charSelect)
  6. Re-render everything (presets, combo, timeline)
```

### Input → Combo Pipeline

```
inputManager (keyboard capture)
    ↓
recordDirection() → commandParser.recordDirection()
    ↓
emit InputEvent → processDetectedMove()
    ↓
commandParser.detect() → finds move ID (e.g., "5LP", "236236P")
    ↓
comboEngine.addMove(move) → validates connection
    ↓
renderCombo() & renderFrameTimeline() → update UI
```

### Key Input Processing Details:
- **MOTION_DETECT_DELAY** = 8 frames (waits for motion completion)
- **CHARGE_THRESHOLD** = 16 frames (charged moves detection)
- **SIMULTANEOUS_PRESS_WINDOW** = 3 frames (merge nearby button presses)
- **COMBO_INPUT_TIMEOUT** = 45 frames in comboEngine

### Event Flow
```typescript
inputManager.onInput((event) => {
  // 1. Record direction for motion
  commandParser.recordDirection(event.direction, event.frame)
  
  // 2. Update visual displays
  updateDirectionDisplay(event.direction)
  updateButtonDisplay(inputManager.getCurrentButtons())
  
  // 3. Handle key RELEASE events (charged moves)
  if (!event.pressed && event.holdDurations) {
    // Check for charged versions or motion+release
  }
  
  // 4. Handle KEY PRESS events (buffer inputs)
  if (event.pressed) {
    // Create/merge pending input
    // Try to resolve after SIMULTANEOUS_PRESS_WINDOW
  }
})

frameSim.onTick((frame) => {
  inputManager.tick()
  commandParser.recordDirection(...)
  tryResolvePending() // Delayed motion detection
  comboEngine.tick() // Check combo timeout
})
```

### Mode-Switching Design Pattern
- **Currently monolithic** - only one mode (real-time input simulator)
- **For new mode**: Could:
  1. Add `#mode-selector` in header
  2. Switch between views with `.hidden` class
  3. Pause `frameSim` when not in real-time mode
  4. Create separate event handlers for drag-drop builder

---

## 3. COMBO ENGINE (src/engine/combo-engine.ts)

### ComboEngine Structure
```typescript
export class ComboEngine {
  private dmgCalc = new DamageCalculator()
  private comboMoves: {
    move: MoveData
    connectionType: ComboConnectionType | null
    isDriveRush: boolean
  }[] = []
  
  private combo: ComboState = this.emptyCombo()
  private isDriveRushing = false
  private timeoutRemaining = 0
  private comboActive = false
}
```

### Key Methods for Reuse

#### `addMove(move: MoveData)` - Core Method
```typescript
addMove(move: MoveData): {
  success: boolean
  connectionType: ComboConnectionType | null
  message: string
}
```

**Logic Flow:**
1. Check if previous combo completed/dropped → reset
2. Check if previous move caused knockdown → end combo, start new
3. If no moves yet → first move always succeeds
4. For subsequent moves:
   a. Find "effective last move" (skip Drive Rush #66)
   b. Check Drive Rush special case (id === '66')
   c. Check cancel connection (priority 1)
   d. Check link connection (priority 2)
   e. If neither → combo dropped, start fresh

**Connection Type Checks:**
- **Cancel**: Must have `cancel` property on previous move
  - Chains (light→light): Always combo
  - Target Combos: Hardcoded sequences
  - Special/Super: Check `startup <= hitstun`
  - Drive Rush: Special flag
  
- **Link**: Wait for full recovery
  - Check `startup <= hitAdv + bonuses`
  - Drive Rush adds +4 frame bonus

- **Drive Rush**: Only from moves with 'Sp' cancel property

### ComboState Type
```typescript
interface ComboState {
  hits: ComboHit[]                    // Array of hits with damage info
  totalDamage: number
  hitCount: number
  isValid: boolean                    // Currently connecting?
  driveGaugeUsed: number
  superGaugeUsed: number
  currentScaling: number              // Current damage scaling (0-1)
  endReason: 'active' | 'completed' | 'dropped'
  dropInfo?: string                   // Why combo dropped
  completionInfo?: string             // Completion message
}
```

### ComboHit Type
```typescript
interface ComboHit {
  move: MoveData
  hitNumber: number                   // 1-based hit count
  connectionType: ComboConnectionType | null
  rawDamage: number
  scaledDamage: number
  scalingPercent: number              // 0-100%
  frameInCombo: number                // When move started
  isDriveRush: boolean
}
```

### Connection Types
```typescript
type ComboConnectionType = 
  | 'link'                            // Wait for recovery
  | 'cancel'                          // Special/Super cancel
  | 'chain'                           // Light→Light chaining
  | 'target_combo'                    // Hardcoded sequences
  | 'dr_cancel'                       // Drive Rush cancel
  | 'juggle'                          // Not yet implemented
```

### Other Useful Methods
```typescript
getCombo(): ComboState                // Current state
isComboActive(): boolean
getComboMoves(): ComboMove[]          // Array with connection info
reset(): void                         // Clear everything
tick(): void                          // Called by frameSim each frame
onComboUpdate(cb): void               // Register listener
validateCombo(moveIds): ComboState    // For presets
```

### Timeout & Combo Completion
- **COMBO_INPUT_TIMEOUT** = 45 frames (~0.75s at 60fps)
- Reset on each move addition
- When timeout expires: `combo.endReason = 'completed'`
- Used to detect "user stopped inputting"

### Damage Calculation (via DamageCalculator)
- Integrated but handled separately
- Called via `recalculate()` in combo engine
- Returns new ComboState with damage values

---

## 4. FRAME TIMELINE RENDERING

### renderFrameTimeline() Function
Located in main.ts (~194-283 lines)

**Input:** `combo: ComboState`
**Output:** Canvas rendering at #frame-timeline

**Algorithm:**
```
1. Get canvas context and size from parent
2. Clear canvas
3. If no moves: draw empty state message
4. Build moveFrames array with:
   - startup (green, calculated from move.startup)
   - active (red, parsed from move.active string)
   - recovery (blue, from move.recovery)
5. Calculate totalFrames and pixelsPerFrame ratio
6. Draw each move's bars:
   - Startup: #44cc66
   - Active: #ff4444
   - Recovery: #4488ff
7. Add move labels above bars
8. Draw legend at bottom
```

**Key Calculations:**
```typescript
// Parse active frames (e.g., "2,5" → 7)
const activeParts = move.active.split(',').map(s => parseInt(s))
const activeTotal = activeParts.reduce((a, b) => a + b, 0)

// Calculate pixel scaling
const pixelsPerFrame = Math.max(2, (width - 20) / totalFrames)

// Draw bars with colors
ctx.fillStyle = '#44cc66'; // startup
ctx.fillRect(x, y, startup * pixelsPerFrame, height)
```

**Legend Colors:**
- Green (#44cc66) = Startup (move is active)
- Red (#ff4444) = Active (hitting opponent)
- Blue (#4488ff) = Recovery (can be hit)

**Reusable for Combo Builder:**
- ✅ Can be called independently
- ✅ Takes ComboState as parameter
- ✅ Just needs canvas element reference
- ✅ Could add interactivity (hover tooltips, click to remove)

---

## 5. CSS LAYOUT STRUCTURE (src/style.css)

### CSS Variables (Color Theme)
```css
:root {
  --bg-primary: #0a0a0f
  --bg-secondary: #12121a
  --bg-panel: #1a1a2e
  --bg-hover: #252540
  --text-primary: #e8e8f0
  --text-secondary: #8888a0
  --accent: #ff4444          (red)
  --accent-blue: #4488ff
  --accent-green: #44cc66
  --accent-yellow: #ffcc00
  --accent-purple: #aa66ff
  --border: #2a2a44
  --frame-startup: #44cc66
  --frame-active: #ff4444
  --frame-recovery: #4488ff
}
```

### Grid Layout
```css
#main {
  display: grid
  grid-template-columns: 260px 1fr 300px    /* Fixed | Flexible | Fixed */
  gap: 0
  flex: 1
  overflow: hidden
}

.panel {
  padding: 12px
  border-right: 1px solid var(--border)
  overflow-y: auto                          /* Scrollable */
}
```

### Key Component Styles

**Input Display:**
```css
.direction-grid {
  display: grid
  grid-template-columns: repeat(3, 40px)
  grid-template-rows: repeat(3, 40px)
  gap: 3px
}

.dir / .game-btn {
  background: var(--bg-secondary)
  border: 1px solid var(--border)
  transition: all 0.1s
}

.dir.active / .game-btn.active {
  background: var(--accent)
  color: #fff
  box-shadow: 0 0 8px rgba(255, 68, 68, 0.5)
}
```

**Combo Sequence:**
```css
#combo-sequence {
  display: flex
  flex-wrap: wrap
  gap: 4px
  min-height: 48px
  padding: 10px
  background: var(--bg-secondary)
  border: 1px solid var(--border)
}

.combo-move {
  padding: 4px 10px
  background: var(--bg-panel)
  border: 1px solid var(--border)
}

.combo-move.valid { border-color: var(--accent-green) }
.combo-move.invalid { border-color: var(--accent) }
```

**Frame Timeline:**
```css
#frame-timeline-container {
  width: 100%
  height: 80px
  margin-bottom: 12px
  background: var(--bg-secondary)
  border: 1px solid var(--border)
  overflow: hidden
}
```

**Preset Combos:**
```css
.preset-combo {
  padding: 10px
  background: var(--bg-secondary)
  border: 1px solid var(--border)
  cursor: pointer
}

.preset-combo:hover { background: var(--bg-hover) }
.preset-combo.selected { border-color: var(--accent) }
```

### Modal Overlay
```css
#modal-overlay {
  position: fixed
  inset: 0
  background: rgba(0, 0, 0, 0.7)
  z-index: 100
}
```

### Scrollbar Styling
```css
::-webkit-scrollbar {
  width: 6px
}
::-webkit-scrollbar-thumb {
  background: var(--border)
  border-radius: 3px
}
```

**For Drag-Drop Combo Builder:**
- ✅ Can reuse all CSS variables
- ✅ Can reuse grid layout and panel styles
- ✅ Can add `.dragging` / `.drag-over` states
- ✅ Color scheme consistent with existing UI
- ⚠️ May need new styles for:
  - Drag preview/ghost elements
  - Drop zones
  - Drag handles on moves
  - Animation feedback (snap, bounce)

---

## 6. TYPES.TS - KEY DATA STRUCTURES

### MoveData Interface
```typescript
interface MoveData {
  id: string                  // Unique key: "5LP", "236HP", "66"
  input: string               // Display: "5LP", "→ HP"
  name?: string
  
  // Frame data
  damage: number              // Raw damage
  startup: number             // Frames until active (first hit frame)
  active: string              // Active frames: "3" or "2,5" (multi-hit)
  recovery: number            // Recovery frames after last active frame
  total: number               // startup + active + recovery
  
  // Advantage data
  hitAdv: string              // On-hit: "+5", "KD", "HKD -2", etc.
  blockAdv: string            // On-block: "-1", "-5", etc.
  
  // Properties
  guard: string               // Guard type: "L", "H", "LH", "T" (throw)
  cancel: string              // Cancel properties: "Chn Sp SA PS TC -"
  hitconfirm: string          // Hitconfirm window
  
  // Hit effects
  hitstun: number             // Opponent hitstun frames
  blockstun: number           // Opponent blockstun frames
  hitstop: number             // Hit freeze frames
  
  // Scaling
  dmgScaling: string          // "20% Starter", "20% Immediate", etc.
  drCancelOnHit: string       // Frame advantage after DR
  drCancelOnBlock: string
  afterDrOnHit: string
  afterDrOnBlock: string
  
  // Gauges
  driveDmgBlock: number
  driveDmgHit: number
  driveGain: number           // Negative = uses gauge
  superGainHit: string        // "300 (210)"
  superGainBlock: string
  
  // Other
  punishAdv: string
  perfParryAdv: string
  invuln: string              // Invulnerability frames
  armor: string
  airborne: string
  range: string
  notes: string
  category: MoveCategory      // 'normal' | 'special' | 'super' etc.
}
```

### CharacterData Interface
```typescript
interface CharacterData {
  name: string                // "Alex", "Terry"
  hp: number
  throwRange: number
  fwdWalkSpeed: number
  backWalkSpeed: number
  fwdDashFrames: number
  backDashFrames: number
  moves: MoveData[]           // All available moves
}
```

### ComboState (Already covered in section 3)

### Important Enums
```typescript
type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
// Numpad notation: 5=neutral, 6=forward, 4=back, 8=up, 2=down
// 7=up-back, 9=up-forward, 1=down-back, 3=down-forward

type AttackButton = 'LP' | 'MP' | 'HP' | 'LK' | 'MK' | 'HK'

type MoveCategory = 
  | 'normal' | 'command' | 'target_combo' | 'throw'
  | 'drive' | 'special' | 'prowler' | 'super'

type ComboConnectionType = 
  | 'link' | 'cancel' | 'chain' 
  | 'target_combo' | 'dr_cancel' | 'juggle'

type ComboEndReason = 'active' | 'completed' | 'dropped'
```

### Direction/Button Symbol Mapping
```typescript
const DIRECTION_SYMBOLS: Record<Direction, string> = {
  1: '↙', 2: '↓', 3: '↘',
  4: '←', 5: '●', 6: '→',
  7: '↖', 8: '↑', 9: '↗',
}

const BUTTON_COLORS: Record<AttackButton, string> = {
  LP: '#5b9bd5', MP: '#ffc000', HP: '#00b050',
  LK: '#5b9bd5', MK: '#ffc000', HK: '#00b050',
}
```

---

## 7. REUSABILITY ANALYSIS FOR COMBO BUILDER MODE

### ✅ READY TO REUSE AS-IS

**ComboEngine:**
- `addMove(move)` - Validate connection logic
- `reset()` - Clear combo
- `getCombo()` - Get current state
- `validateCombo(moveIds)` - Test preset sequences
- Damage calculation integrated
- Connection type detection logic

**Frame Timeline Rendering:**
- `renderFrameTimeline(combo)` - Canvas drawing
- Can be called independently
- Just needs ComboState and canvas element

**Types & Data:**
- All MoveData structures (immutable)
- ComboState interface
- Connection types enum
- CharacterData & move database

**UI Components & Styling:**
- CSS grid layout
- Color scheme (all CSS variables)
- Modal overlay system
- Button/panel styles

**DamageCalculator:**
- `calculateCombo(moves)` - Recalculate damage
- Hit scaling formula
- Damage modifiers (starter, immediate, etc.)

### ⚠️ NEEDS MODIFICATION

**InputManager:**
- Tied to keyboard input
- For builder: Might not need (or need minimal)
- Would need to decouple direction/button logic

**CommandParser:**
- Focused on real-time motion detection
- For builder: Could reuse move lookup (`findMove()`)
- Motion detection not needed for UI-based builder

**FrameSimulator:**
- Runs game loop at 60fps
- For builder: Pause when switching modes
- Or run simplified version

### ❌ NEW COMPONENTS NEEDED

**Drag-Drop System:**
- HTML structure for draggable move cards
- Drag start/over/drop event handlers
- Ghost element rendering
- Drop zone highlighting

**Move Selection UI:**
- Move list/picker (could reuse modal system)
- Filter by category/connection type
- Search functionality
- Availability check (can this move connect?)

**Builder Sequence Display:**
- Different from combo-sequence (static vs interactive)
- Drag handles on each move
- Remove buttons
- Reorder controls (drag-up/down or buttons)

**Visual Feedback:**
- Animation on move add/remove
- Connection validation indicator
- Hover tooltips
- Undo/redo system (optional)

**Preset Export/Save:**
- UI to create new preset combos
- Save to localStorage or backend
- Load in real-time simulator

---

## 8. CURRENT PIPELINE SUMMARY

```
┌─────────────────────────────────────────────────────────────────┐
│ REAL-TIME SIMULATOR MODE (Current)                              │
└─────────────────────────────────────────────────────────────────┘

KEYBOARD INPUT
    ↓
InputManager
  • Track held keys
  • Calculate current direction (numpad notation)
  • Emit InputEvent (frame, direction, buttons, pressed)
    ↓
Main.ts Event Handler
  • Record direction: commandParser.recordDirection()
  • Update visual displays
  • Handle release events (charged moves)
  • Buffer/merge press events
    ↓
CommandParser.detect()
  • Match motion commands (236, 623, etc.)
  • Match button combinations
  • Return moveId (e.g., "236HP", "5LP")
    ↓
ComboEngine.addMove(move)
  • Validate connection (cancel/link/chain)
  • Calculate damage scaling
  • Emit ComboState
    ↓
Rendering
  • renderCombo() → combo-sequence display
  • renderFrameTimeline() → canvas timeline
  • Update stats (damage, scaling, drive, status)


┌─────────────────────────────────────────────────────────────────┐
│ DRAG-DROP COMBO BUILDER MODE (To Implement)                     │
└─────────────────────────────────────────────────────────────────┘

USER DRAGS MOVE CARD
    ↓
Drag Event Handlers
  • dragstart → clone move element
  • dragover → highlight drop zones
  • drop → add move to combo sequence
    ↓
ComboEngine.addMove(move) ← REUSE THIS
    ↓
ComboState Updated
    ↓
Rendering
  • renderCombo() → REUSE THIS
  • renderFrameTimeline() → REUSE THIS
  • Update builder-specific UI
    ↓
User Can:
  • Reorder moves (drag within sequence)
  • Remove moves (X button or drag-out)
  • Save as preset
  • Test in real-time simulator
```

---

## 9. KEY INTEGRATION POINTS

### For Mode Switching
1. Add `.hidden` class to panels instead of `display: none`
2. Pause `frameSim` when entering builder mode
3. Keep `comboEngine` state across modes
4. Reuse modal system for move selector

### For Combo Builder
1. Keep separate drag event listeners
2. Reuse `ComboEngine.addMove()` validation
3. Reuse `renderCombo()` and `renderFrameTimeline()`
4. Add builder-specific CSS classes
5. Integrate with preset system

### Data Flow
- **Shared state**: `currentCharData`, `currentCombos`, `comboEngine`
- **Mode-specific**: Input handling, visual feedback, drag system
- **Reused functions**: Rendering, validation, damage calculation

---

## 10. CRITICAL FINDINGS

### Strengths
1. ✅ Clean separation of concerns (engines are independent)
2. ✅ ComboEngine is well-tested and validates correctly
3. ✅ Frame timeline rendering is canvas-based and reusable
4. ✅ CSS is fully themeable via variables
5. ✅ TypeScript ensures type safety

### Gotchas
1. ⚠️ ComboEngine expects `MoveData` objects (not just IDs)
2. ⚠️ Frame timeline needs exact canvas sizing via parent
3. ⚠️ DamageCalculator depends on move data accuracy
4. ⚠️ Connection logic assumes "opponent always holding block"
5. ⚠️ Motion detection history is frame-based (may be stale)

### Performance Considerations
1. ⚠️ FrameSimulator runs at 60fps even when not needed
2. ⚠️ CommandParser keeps 60-frame direction history
3. ⚠️ Canvas rendering recalculates on every combo update
4. ✅ ComboEngine operations are O(n) where n = combo length

### Module Dependencies
```
main.ts (main logic)
├── InputManager (keyboard→input events)
├── CommandParser (motion/button detection)
├── ComboEngine (connection validation + damage)
│   └── DamageCalculator
├── FrameSimulator (60fps game loop)
└── Character Data (moves, combos)
```

