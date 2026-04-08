import './style.css';
import { InputManager } from './engine/input-manager';
import { CommandParser } from './engine/command-parser';
import { ComboEngine } from './engine/combo-engine';
import { FrameSimulator } from './engine/frame-simulator';
import { DamageCalculator } from './engine/damage-calculator';
import { ALEX_DATA, ALEX_COMBOS } from './data/alex';
import { ComboBuilder } from './ui/combo-builder';
import { Direction, AttackButton, DIRECTION_SYMBOLS, MoveData, KeyBindings, DEFAULT_KEYBINDINGS, ComboState, ComboConnectionType, CharacterData } from './types';

// ===== Character Registry =====
interface CharacterEntry {
  data: CharacterData;
  combos: typeof ALEX_COMBOS;
}

const CHARACTERS: Record<string, () => Promise<CharacterEntry>> = {
  alex: async () => {
    const { ALEX_DATA, ALEX_COMBOS } = await import('./data/alex');
    return { data: ALEX_DATA, combos: ALEX_COMBOS };
  },
  terry: async () => {
    const { TERRY_DATA, TERRY_COMBOS } = await import('./data/terry');
    return { data: TERRY_DATA, combos: TERRY_COMBOS };
  },
};

// ===== Current character state =====
let currentCharacterName = localStorage.getItem('sf6-character') || 'alex';
let currentCharData: CharacterData = ALEX_DATA;
let currentCombos: typeof ALEX_COMBOS = ALEX_COMBOS;

// ===== Initialize Engines =====
const inputManager = new InputManager();
const commandParser = new CommandParser(currentCharData);
const comboEngine = new ComboEngine();
const frameSim = new FrameSimulator();

// ===== DOM Elements =====
const directionEls = document.querySelectorAll<HTMLElement>('.dir');
const buttonEls = document.querySelectorAll<HTMLElement>('.game-btn');
const inputHistoryEl = document.getElementById('input-history')!;
const comboSequenceEl = document.getElementById('combo-sequence')!;
const frameTimelineCanvas = document.getElementById('frame-timeline') as HTMLCanvasElement;
const detectedMoveEl = document.getElementById('detected-move')!;
const statDamageEl = document.getElementById('stat-damage')!;
const statScalingEl = document.getElementById('stat-scaling')!;
const statDriveEl = document.getElementById('stat-drive')!;
const statStatusEl = document.getElementById('stat-status')!;
const comboHitCountEl = document.getElementById('combo-hit-count')!;
const presetCombosEl = document.getElementById('preset-combos')!;
const btnSettings = document.getElementById('btn-settings')!;
const btnMovelist = document.getElementById('btn-movelist')!;
const btnReset = document.getElementById('btn-reset')!;
const modalOverlay = document.getElementById('modal-overlay')!;
const modalBody = document.getElementById('modal-body')!;
const modalClose = document.getElementById('modal-close')!;
const charSelect = document.getElementById('char-select') as HTMLSelectElement;
const charNameEl = document.getElementById('char-name')!;

// ===== Combo Builder =====
let comboBuilder: ComboBuilder | null = null;
let currentMode: 'input' | 'builder' = 'input';

function switchMode(mode: 'input' | 'builder'): void {
  currentMode = mode;
  document.getElementById('main')!.classList.toggle('hidden', mode !== 'input');
  document.getElementById('builder-main')!.classList.toggle('hidden', mode !== 'builder');

  // Update tab styles
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.mode === mode);
  });

  if (mode === 'input') {
    frameSim.start();
  } else {
    frameSim.stop();
    // Lazy init combo builder
    if (!comboBuilder) {
      comboBuilder = new ComboBuilder(currentCharData);
    }
  }
}

// ===== Character Switching =====
async function switchCharacter(name: string): Promise<void> {
  const loader = CHARACTERS[name];
  if (!loader) {
    console.error(`Unknown character: ${name}`);
    return;
  }
  try {
    const { data, combos } = await loader();
    currentCharacterName = name;
    currentCharData = data;
    currentCombos = combos;

    // Update engines
    commandParser.setCharacter(data);
    comboEngine.reset();

    // Update builder if initialized
    if (comboBuilder) {
      comboBuilder.setCharacter(data);
    }

    // Update UI
    charNameEl.textContent = data.name.toUpperCase();
    charSelect.value = name;
    localStorage.setItem('sf6-character', name);

    // Re-render
    renderPresetCombos();
    renderCombo(comboEngine.getCombo());
    renderFrameTimeline(comboEngine.getCombo());
    inputHistory.length = 0;
    renderInputHistory();
    detectedMoveEl.textContent = '-';

    console.log(`Switched to ${data.name}: ${data.moves.length} moves loaded`);
  } catch (e) {
    console.error(`Failed to load character ${name}:`, e);
  }
}

// ===== Input History =====
interface InputHistoryEntry {
  frame: number;
  direction: Direction;
  buttons: AttackButton[];
}

const inputHistory: InputHistoryEntry[] = [];
const MAX_HISTORY = 40;

function addInputHistory(frame: number, direction: Direction, buttons: AttackButton[]): void {
  inputHistory.push({ frame, direction, buttons });
  if (inputHistory.length > MAX_HISTORY) inputHistory.shift();
  renderInputHistory();
}

function renderInputHistory(): void {
  inputHistoryEl.innerHTML = inputHistory.map(entry => {
    const dirSymbol = DIRECTION_SYMBOLS[entry.direction];
    const btns = entry.buttons.map(b =>
      `<span class="input-btn-tag ${b}">${b}</span>`
    ).join('');
    return `<div class="input-entry">
      <span class="input-frame">${entry.frame}</span>
      <span class="input-dir">${dirSymbol}</span>
      <span class="input-btns">${btns}</span>
    </div>`;
  }).reverse().join('');
}

// ===== Direction & Button Display =====
function updateDirectionDisplay(dir: Direction): void {
  directionEls.forEach(el => {
    const d = parseInt(el.dataset.dir || '5');
    el.classList.toggle('active', d === dir);
  });
}

function updateButtonDisplay(buttons: Set<AttackButton>): void {
  buttonEls.forEach(el => {
    const btn = el.dataset.btn as AttackButton;
    el.classList.toggle('active', buttons.has(btn));
  });
}

// ===== Combo Display =====
function renderCombo(combo: ComboState): void {
  const moves = comboEngine.getComboMoves();
  if (moves.length === 0) {
    comboSequenceEl.innerHTML = '<span style="color: var(--text-secondary); font-size: 13px;">Press buttons to start a combo...</span>';
    comboHitCountEl.textContent = '0 HITS';
    statDamageEl.textContent = '0';
    statScalingEl.textContent = '100%';
    statDriveEl.textContent = '0';
    statStatusEl.textContent = 'READY';
    statStatusEl.className = 'stat-value valid';
    return;
  }

  const connectorSymbols: Record<string, string> = {
    chain: '~',
    cancel: '>',
    link: ',',
    target_combo: '~',
    dr_cancel: '>>',
    juggle: ',',
  };

  let html = '';
  for (let i = 0; i < moves.length; i++) {
    const { move, connectionType, isDriveRush } = moves[i];
    const hit = combo.hits[i];
    const isValid = combo.isValid || i < moves.length - 1;

    if (i > 0 && connectionType) {
      html += `<span class="combo-connector">${connectorSymbols[connectionType] || '>'}</span>`;
    }

    const drTag = isDriveRush ? ' <span style="color: var(--accent-purple); font-size: 10px;">DR</span>' : '';
    const dmgText = hit ? ` <span style="color: var(--text-secondary); font-size: 10px;">${hit.scaledDamage}</span>` : '';

    html += `<span class="combo-move ${connectionType !== null || i === 0 ? 'valid' : 'invalid'}">${move.input}${drTag}${dmgText}</span>`;
  }

  comboSequenceEl.innerHTML = html;
  comboHitCountEl.textContent = `${combo.hitCount} HIT${combo.hitCount !== 1 ? 'S' : ''}`;
  statDamageEl.textContent = combo.totalDamage.toString();
  statScalingEl.textContent = `${Math.round(combo.currentScaling * 100)}%`;
  statDriveEl.textContent = (combo.driveGaugeUsed / 10000).toFixed(0);
  statStatusEl.textContent = combo.endReason === 'active'
    ? (combo.isValid ? 'COMBO' : 'DROPPED')
    : combo.endReason === 'completed'
    ? 'COMPLETE'
    : 'DROPPED';
  statStatusEl.className = `stat-value ${combo.endReason === 'dropped' ? 'invalid' : 'valid'}`;
}

// ===== Frame Timeline =====
function renderFrameTimeline(combo: ComboState): void {
  const ctx = frameTimelineCanvas.getContext('2d');
  if (!ctx) return;

  const rect = frameTimelineCanvas.parentElement!.getBoundingClientRect();
  frameTimelineCanvas.width = rect.width;
  frameTimelineCanvas.height = rect.height;

  ctx.clearRect(0, 0, frameTimelineCanvas.width, frameTimelineCanvas.height);

  const moves = comboEngine.getComboMoves();
  if (moves.length === 0) {
    // Draw empty state
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, frameTimelineCanvas.width, frameTimelineCanvas.height);
    ctx.fillStyle = '#8888a0';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Frame timeline will appear here', frameTimelineCanvas.width / 2, frameTimelineCanvas.height / 2);
    return;
  }

  // Calculate total frames for all moves
  let totalFrames = 0;
  const moveFrames: { move: MoveData; startFrame: number; startup: number; active: number; recovery: number }[] = [];

  for (const { move } of moves) {
    const startup = move.startup || 1;
    const activeParts = (move.active || '1').split(',').map(s => parseInt(s) || 1);
    const activeTotal = activeParts.reduce((a, b) => a + b, 0);
    const recovery = move.recovery || 1;

    moveFrames.push({ move, startFrame: totalFrames, startup, active: activeTotal, recovery });
    totalFrames += startup + activeTotal + recovery;
  }

  if (totalFrames === 0) return;

  const pixelsPerFrame = Math.max(2, (frameTimelineCanvas.width - 20) / totalFrames);
  const barHeight = 30;
  const startX = 10;
  const startY = (frameTimelineCanvas.height - barHeight) / 2;

  // Draw background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, frameTimelineCanvas.width, frameTimelineCanvas.height);

  for (const mf of moveFrames) {
    let x = startX + mf.startFrame * pixelsPerFrame;

    // Startup (green)
    ctx.fillStyle = '#44cc66';
    ctx.fillRect(x, startY, mf.startup * pixelsPerFrame, barHeight);
    x += mf.startup * pixelsPerFrame;

    // Active (red)
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(x, startY, mf.active * pixelsPerFrame, barHeight);
    x += mf.active * pixelsPerFrame;

    // Recovery (blue)
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(x, startY, mf.recovery * pixelsPerFrame, barHeight);

    // Move label
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    const labelX = startX + mf.startFrame * pixelsPerFrame + 2;
    ctx.fillText(mf.move.input, labelX, startY - 4);
  }

  // Legend
  const legendY = startY + barHeight + 14;
  const legends = [
    { color: '#44cc66', label: 'Startup' },
    { color: '#ff4444', label: 'Active' },
    { color: '#4488ff', label: 'Recovery' },
  ];
  let legendX = startX;
  ctx.font = '10px system-ui';
  for (const l of legends) {
    ctx.fillStyle = l.color;
    ctx.fillRect(legendX, legendY - 8, 8, 8);
    ctx.fillStyle = '#8888a0';
    ctx.textAlign = 'left';
    ctx.fillText(l.label, legendX + 12, legendY);
    legendX += 80;
  }
}

// ===== Preset Combos =====
function renderPresetCombos(): void {
  presetCombosEl.innerHTML = currentCombos.map((combo, idx) => {
    const diffClass = combo.difficulty.toLowerCase().includes('easy') ? 'easy' :
                      combo.difficulty.toLowerCase().includes('intermediate') ? 'intermediate' : 'hard';
    return `<div class="preset-combo" data-idx="${idx}">
      <div class="preset-name">${combo.name}</div>
      <div class="preset-notation">${combo.notation}</div>
      <div class="preset-meta">
        <span class="preset-dmg">DMG: ${combo.damage}</span>
        <span>Drive: ${combo.driveGauge}</span>
        <span class="preset-difficulty ${diffClass}">${combo.difficulty}</span>
      </div>
    </div>`;
  }).join('');

  // Click to load preset
  presetCombosEl.querySelectorAll('.preset-combo').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt((el as HTMLElement).dataset.idx || '0');
      const preset = currentCombos[idx];
      if (!preset) return;

      comboEngine.reset();
      for (const stepId of preset.steps) {
        const move = currentCharData.moves.find(m => m.id === stepId);
        if (move) {
          const result = comboEngine.addMove(move);
          console.log(result.message);
        }
      }
      renderCombo(comboEngine.getCombo());
      renderFrameTimeline(comboEngine.getCombo());

      // Highlight selected
      presetCombosEl.querySelectorAll('.preset-combo').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

// ===== Settings Modal =====
function showSettingsModal(): void {
  const bindings = inputManager.getBindings();
  const keys = Object.entries(bindings) as [keyof KeyBindings, string][];

  const labels: Record<keyof KeyBindings, string> = {
    up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    LP: 'LP (Light Punch)', MP: 'MP (Medium Punch)', HP: 'HP (Heavy Punch)',
    LK: 'LK (Light Kick)', MK: 'MK (Medium Kick)', HK: 'HK (Heavy Kick)',
    LPLK: 'LP+LK (Throw)', MPMK: 'MP+MK (Drive Parry)', HPHK: 'HP+HK (Drive Impact)',
  };

  modalBody.innerHTML = `
    <h3 style="margin-bottom: 16px; font-size: 16px;">Key Bindings</h3>
    <div class="keybind-list">
      ${keys.map(([action, key]) => `
        <div class="keybind-row">
          <span class="keybind-label">${labels[action]}</span>
          <span class="keybind-key" data-action="${action}">${formatKeyName(key)}</span>
        </div>
      `).join('')}
    </div>
    <div style="margin-top: 16px; display: flex; gap: 8px;">
      <button id="keybind-save" class="header-btn" style="background: var(--accent); border-color: var(--accent);">Save</button>
      <button id="keybind-reset" class="header-btn">Reset to Default</button>
    </div>
  `;

  // Key recording
  let listeningEl: HTMLElement | null = null;
  let listeningAction: string | null = null;
  const newBindings = { ...bindings };

  modalBody.querySelectorAll('.keybind-key').forEach(el => {
    el.addEventListener('click', () => {
      if (listeningEl) listeningEl.classList.remove('listening');
      listeningEl = el as HTMLElement;
      listeningAction = el.getAttribute('data-action');
      el.classList.add('listening');
      el.textContent = 'Press a key...';
    });
  });

  const keyHandler = (e: KeyboardEvent) => {
    if (!listeningEl || !listeningAction) return;
    e.preventDefault();
    e.stopPropagation();

    const key = e.key;
    (newBindings as any)[listeningAction] = key;
    listeningEl.textContent = formatKeyName(key);
    listeningEl.classList.remove('listening');
    listeningEl = null;
    listeningAction = null;
  };

  window.addEventListener('keydown', keyHandler, true);

  document.getElementById('keybind-save')!.addEventListener('click', () => {
    inputManager.saveBindings(newBindings as KeyBindings);
    window.removeEventListener('keydown', keyHandler, true);
    closeModal();
  });

  document.getElementById('keybind-reset')!.addEventListener('click', () => {
    inputManager.saveBindings({ ...DEFAULT_KEYBINDINGS });
    window.removeEventListener('keydown', keyHandler, true);
    closeModal();
    showSettingsModal();
  });

  modalOverlay.classList.remove('hidden');

  // Clean up key handler when modal closes
  const origClose = closeModal;
  const wrappedClose = () => {
    window.removeEventListener('keydown', keyHandler, true);
    origClose();
  };
  modalClose.onclick = wrappedClose;
}

function formatKeyName(key: string): string {
  const map: Record<string, string> = {
    'ArrowUp': 'Arrow Up', 'ArrowDown': 'Arrow Down',
    'ArrowLeft': 'Arrow Left', 'ArrowRight': 'Arrow Right',
    ' ': 'Space', 'Control': 'Ctrl', 'Shift': 'Shift',
  };
  return map[key] || key.toUpperCase();
}

// ===== Move List Modal =====
function showMoveListModal(): void {
  const categories = [
    { key: 'normal', label: 'Normals' },
    { key: 'command', label: 'Command Normals' },
    { key: 'target_combo', label: 'Target Combos' },
    { key: 'throw', label: 'Throws' },
    { key: 'drive', label: 'Drive System' },
    { key: 'special', label: 'Special Moves' },
    { key: 'prowler', label: 'Prowler Stance' },
    { key: 'super', label: 'Super Arts' },
  ];

  let currentFilter = 'all';

  function renderTable(filter: string): string {
    const moves = filter === 'all'
      ? currentCharData.moves
      : currentCharData.moves.filter(m => m.category === filter);

    return `
      <div class="movelist-filter">
        <span class="filter-btn ${filter === 'all' ? 'active' : ''}" data-filter="all">All</span>
        ${categories.map(c =>
          `<span class="filter-btn ${filter === c.key ? 'active' : ''}" data-filter="${c.key}">${c.label}</span>`
        ).join('')}
      </div>
      <table class="movelist-table">
        <thead>
          <tr>
            <th>Input</th>
            <th>Name</th>
            <th>Damage</th>
            <th>Startup</th>
            <th>Active</th>
            <th>Recovery</th>
            <th>On Hit</th>
            <th>On Block</th>
            <th>Cancel</th>
          </tr>
        </thead>
        <tbody>
          ${moves.map(m => `
            <tr>
              <td style="font-weight: 600; color: var(--accent-yellow);">${m.input}</td>
              <td style="font-size: 11px;">${m.name || '-'}</td>
              <td>${m.damage || '-'}</td>
              <td style="color: var(--frame-startup);">${m.startup || '-'}</td>
              <td style="color: var(--frame-active);">${m.active || '-'}</td>
              <td style="color: var(--frame-recovery);">${m.recovery || '-'}</td>
              <td style="color: ${(m.hitAdv || '').startsWith('+') ? 'var(--accent-green)' : (m.hitAdv || '').startsWith('-') ? 'var(--accent)' : 'var(--text-primary)'};">${m.hitAdv || '-'}</td>
              <td style="color: ${(m.blockAdv || '').startsWith('+') ? 'var(--accent-green)' : (m.blockAdv || '').startsWith('-') ? 'var(--accent)' : 'var(--text-primary)'};">${m.blockAdv || '-'}</td>
              <td style="font-size: 10px;">${m.cancel || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  modalBody.innerHTML = `<h3 style="margin-bottom: 16px; font-size: 16px;">Alex - Move List</h3>
    <div id="movelist-content">${renderTable('all')}</div>`;

  // Filter buttons
  function attachFilters() {
    modalBody.querySelectorAll('.filter-btn').forEach(el => {
      el.addEventListener('click', () => {
        const filter = (el as HTMLElement).dataset.filter || 'all';
        document.getElementById('movelist-content')!.innerHTML = renderTable(filter);
        attachFilters(); // re-attach after re-render
      });
    });
  }
  attachFilters();

  modalOverlay.classList.remove('hidden');
}

function closeModal(): void {
  modalOverlay.classList.add('hidden');
  modalBody.innerHTML = '';
}

// ===== Wire Everything Up =====

// Input handler with motion-aware delayed detection
// When a button is pressed during what looks like a motion input (e.g. ↓ held),
// we delay detection by a few frames to see if a motion command completes.
const CHARGE_THRESHOLD = 16;
const MOTION_DETECT_DELAY = 8; // frames to wait for motion completion
const SIMULTANEOUS_PRESS_WINDOW = 3; // frames to merge near-simultaneous button presses

interface PendingInput {
  frame: number;
  direction: Direction;
  buttons: AttackButton[];
}

let pendingInput: PendingInput | null = null;
// Track which HP/HK presses were already handled on keydown (so we skip them on release)
const handledOnPress = new Set<string>();

function isMotionInProgress(frame: number): boolean {
  // Check if recent direction history suggests a motion is being input
  // (i.e., there's a recent down, down-forward, or forward that isn't neutral)
  const dir = inputManager.getCurrentDirection();
  // If currently holding a non-neutral direction, a motion might be in progress
  return dir !== 5;
}

function processDetectedMove(moveId: string, moveName: string, frame: number, direction: Direction, buttons: AttackButton[]): void {
  addInputHistory(frame, direction, buttons);

  // If it's a motion command, mark consumed so same directions aren't reused
  // (but double-motions like 236236 can still reuse them)
  const motionMatch = moveId.match(/^(236236|214214|236|623|63214)/);
  if (motionMatch) {
    commandParser.consumeMotion(motionMatch[1], frame);
  }

  const move = commandParser.findMove(moveId);
  if (move) {
    const result = comboEngine.addMove(move);
    console.log(result.message);

    if (result.success) {
      detectedMoveEl.textContent = `${moveId} (${moveName})`;
      detectedMoveEl.style.color = 'var(--accent-yellow)';
    } else {
      detectedMoveEl.textContent = result.message;
      detectedMoveEl.style.color = 'var(--accent)';
    }

    renderCombo(comboEngine.getCombo());
    renderFrameTimeline(comboEngine.getCombo());
  }
}

function getComboContext(): { inCombo: boolean; lastMoveId?: string; lastWasDR: boolean } {
  const inCombo = comboEngine.isComboActive();
  const comboMoves = comboEngine.getComboMoves();
  let lastMoveId: string | undefined;
  let lastWasDR = false;
  for (let i = comboMoves.length - 1; i >= 0; i--) {
    if (comboMoves[i].move.id !== '66') {
      lastMoveId = comboMoves[i].move.id;
      // Check if there's a DR between this attack and the current input
      lastWasDR = i < comboMoves.length - 1 && comboMoves[i + 1].move.id === '66';
      break;
    }
  }
  // If the very last entry is DR, flag it
  if (comboMoves.length > 0 && comboMoves[comboMoves.length - 1].move.id === '66') {
    lastWasDR = true;
  }
  return { inCombo, lastMoveId, lastWasDR };
}

function resolvePendingNow(): void {
  if (!pendingInput) return;

  const { inCombo, lastMoveId, lastWasDR } = getComboContext();
  // Use CURRENT direction (not the one recorded at press time) because
  // the player may press direction and button nearly simultaneously
  const currentDir = inputManager.getCurrentDirection();
  const detected = commandParser.detect(
    currentDir, pendingInput.buttons, inputManager.getFrame(), inCombo, lastMoveId, lastWasDR
  );
  if (detected) {
    processDetectedMove(detected.moveId, detected.moveName, pendingInput.frame, currentDir, pendingInput.buttons);
    for (const btn of pendingInput.buttons) {
      if (['HP', 'HK'].includes(btn)) handledOnPress.add(btn);
    }
  }
  pendingInput = null;
}

function tryResolvePending(): void {
  if (!pendingInput) return;

  const now = inputManager.getFrame();
  const elapsed = now - pendingInput.frame;

  // Must wait at least SIMULTANEOUS_PRESS_WINDOW for button merging
  if (elapsed <= SIMULTANEOUS_PRESS_WINDOW) return;

  // If pending contains ONLY chargeable buttons (HP/HK) and we're NOT in a combo,
  // don't auto-resolve — wait for release to decide charged vs uncharged
  const chargeableOnly = pendingInput.buttons.every(b => ['HP', 'HK'].includes(b));
  if (chargeableOnly && !comboEngine.isComboActive()) return;

  // Try motion detection (may have completed since we started waiting)
  const { inCombo, lastMoveId, lastWasDR } = getComboContext();
  // Use current direction for the same reason as resolvePendingNow
  const currentDir = inputManager.getCurrentDirection();

  const detected = commandParser.detect(
    currentDir, pendingInput.buttons, now, inCombo, lastMoveId, lastWasDR
  );

  if (detected) {
    const isMotion = detected.moveId.match(/^(236|623|63214|214214|236236)/) || detected.isDriveRushCancel;

    if (isMotion || elapsed >= MOTION_DETECT_DELAY) {
      processDetectedMove(detected.moveId, detected.moveName, pendingInput.frame, currentDir, pendingInput.buttons);
      for (const btn of pendingInput.buttons) {
        if (['HP', 'HK'].includes(btn)) handledOnPress.add(btn);
      }
      pendingInput = null;
      return;
    }
  } else if (elapsed >= MOTION_DETECT_DELAY) {
    pendingInput = null;
  }
}

inputManager.onInput((event) => {
  // Record direction for motion detection (both press and release)
  commandParser.recordDirection(event.direction, event.frame);

  // Update visual displays
  updateDirectionDisplay(event.direction);
  if (event.pressed) {
    updateButtonDisplay(new Set(event.buttons));
  } else {
    updateButtonDisplay(inputManager.getCurrentButtons());
  }

  // On key RELEASE: check for charged moves and motion+release combos
  // Only process if we delayed detection on press (i.e., not in combo)
  if (!event.pressed && event.holdDurations) {
    const chargeableButtons: AttackButton[] = ['HP', 'HK'];
    for (const btn of event.buttons) {
      if (!chargeableButtons.includes(btn)) continue;
      const holdDuration = event.holdDurations.get(btn) || 0;
      if (holdDuration <= 0) continue;

      // If this button was already handled on press (immediate detection in combo),
      // don't double-detect on release
      if (handledOnPress.has(btn)) {
        handledOnPress.delete(btn);
        continue;
      }

      // Check motion command first (player did 236 while holding HP)
      const motionDetected = commandParser.detect(
        event.direction, [btn], event.frame,
        false, // not in combo context for this check
        undefined
      );
      if (motionDetected && motionDetected.moveId.match(/^(236|623|63214|214214|236236)/)) {
        pendingInput = null;
        processDetectedMove(motionDetected.moveId, motionDetected.moveName, event.frame, event.direction, [btn]);
        return;
      }

      if (holdDuration >= CHARGE_THRESHOLD) {
        // Charged version (no motion detected)
        let prefix = '';
        const dir = event.direction;
        if (dir === 2 || dir === 1 || dir === 3) prefix = '2';
        else prefix = '5';
        const chargedId = `${prefix}[${btn}]`;
        const move = commandParser.findMove(chargedId);
        if (move) {
          pendingInput = null;
          processDetectedMove(chargedId, move.name || move.input, event.frame, event.direction, [btn]);
          return;
        }
      } else {
        // Short press — resolve as uncharged normal
        let prefix = '';
        const dir = event.direction;
        if (dir === 2 || dir === 1 || dir === 3) prefix = '2';
        else prefix = '5';
        const normalId = prefix + btn;
        const move = commandParser.findMove(normalId);
        if (move) {
          pendingInput = null;
          processDetectedMove(normalId, move.name || move.input, event.frame, event.direction, [btn]);
          return;
        }
      }
    }
    return;
  }

  if (!event.pressed) return;
  if (event.buttons.length === 0) return;

  // If there's a pending input from very recently, MERGE this press into it
  // (handles MP+MK, LP+LK, HP+HK pressed across 2-3 frames)
  if (pendingInput && (event.frame - pendingInput.frame) <= SIMULTANEOUS_PRESS_WINDOW) {
    for (const btn of event.buttons) {
      if (!pendingInput.buttons.includes(btn)) {
        pendingInput.buttons.push(btn);
      }
    }
    // Update direction to latest
    pendingInput.direction = event.direction;
    return; // Don't process yet, let tryResolvePending handle it
  }

  // If there's an older pending input, resolve it now before starting a new one
  if (pendingInput) {
    resolvePendingNow();
  }

  // Always go through pending system for consistent behavior
  pendingInput = { frame: event.frame, direction: event.direction, buttons: [...event.buttons] };
  addInputHistory(event.frame, event.direction, event.buttons);
});

// Frame simulator tick - poll direction every frame for motion detection
frameSim.onTick((frame) => {
  inputManager.tick();
  // Record current direction EVERY frame for motion detection
  commandParser.recordDirection(inputManager.getCurrentDirection(), inputManager.getFrame());
  // Try to resolve pending inputs (delayed motion detection)
  tryResolvePending();
  comboEngine.tick();
});

// Combo engine updates
comboEngine.onComboUpdate((combo) => {
  renderCombo(combo);
  renderFrameTimeline(combo);

  // Update detected move display based on combo end state
  if (combo.endReason === 'completed' && combo.completionInfo) {
    detectedMoveEl.textContent = combo.completionInfo;
    detectedMoveEl.style.color = 'var(--accent-green)';
  } else if (combo.endReason === 'dropped' && combo.dropInfo) {
    detectedMoveEl.textContent = combo.dropInfo;
    detectedMoveEl.style.color = 'var(--accent)';
  }
});

// Button handlers
btnSettings.addEventListener('click', showSettingsModal);
btnMovelist.addEventListener('click', showMoveListModal);
btnReset.addEventListener('click', () => {
  comboEngine.reset();
  commandParser.reset();
  inputHistory.length = 0;
  renderInputHistory();
  renderCombo(comboEngine.getCombo());
  renderFrameTimeline(comboEngine.getCombo());
  detectedMoveEl.textContent = '-';
});

// Mode tab handlers
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = (tab as HTMLElement).dataset.mode as 'input' | 'builder';
    switchMode(mode);
  });
});

// Character select handler
charSelect.addEventListener('change', () => {
  switchCharacter(charSelect.value);
});

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// ===== Initialize =====
// Load saved character or default
(async () => {
  charSelect.value = currentCharacterName;
  if (currentCharacterName !== 'alex') {
    await switchCharacter(currentCharacterName);
  } else {
    charNameEl.textContent = 'ALEX';
  }
  renderPresetCombos();
  renderCombo(comboEngine.getCombo());
  renderFrameTimeline(comboEngine.getCombo());
  frameSim.start();
  console.log('SF6 Combo Simulator initialized');
  console.log(`Loaded ${currentCharData.moves.length} moves for ${currentCharData.name}`);
})();
