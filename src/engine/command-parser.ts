import { Direction, AttackButton, MoveData, CharacterData } from '../types';

// ===== Direction History Entry =====
interface DirectionEntry {
  direction: Direction;
  frame: number;
}

// ===== SF6 Motion Step Definition =====
// Each step in a motion command has a direction, timing constraints, and matching mode
interface MotionStep {
  direction: number;        // required direction (numpad notation: 1-9)
  maxFrames: number;        // max frames gap to next step (timing window)
  matching: 'strict' | 'lenient' | 'optional';
  // strict: exact direction only (2 is only ↓, not ↙ or ↘)
  // lenient: diagonals also count (2 can be matched by 1 or 3; 6 can be matched by 3 or 9)
  // optional: this step can be skipped entirely
}

// ===== SF6 Motion Definition =====
interface MotionDef {
  id: string;               // "236", "623", "63214", "236236", "214214"
  steps: MotionStep[];
  buttonType: 'P' | 'K' | 'PP' | 'KK';
  priority: number;         // SF6 priority: higher = checked first
  isSuper: boolean;         // uses generic P/K suffix (not LP/MP/HP)
  allowNoise: boolean;      // whether unrelated directions between steps are ok
  minOptionalCount?: number; // min number of optional steps that must actually be present
}

// ===== SF6 Precise Motion Definitions =====
// Source: reverse-engineered from SF6 client injection

const MOTIONS: MotionDef[] = [
  // --- OD specials (PP/KK) - highest priority among specials ---
  // QCF + PP/KK
  { id: '236', steps: [
    { direction: 2, maxFrames: 11, matching: 'strict' },
    { direction: 3, maxFrames: 11, matching: 'strict' },
    { direction: 6, maxFrames: 11, matching: 'strict' },
  ], buttonType: 'PP', priority: 150, isSuper: false, allowNoise: true },
  { id: '236', steps: [
    { direction: 2, maxFrames: 11, matching: 'strict' },
    { direction: 3, maxFrames: 11, matching: 'strict' },
    { direction: 6, maxFrames: 11, matching: 'strict' },
  ], buttonType: 'KK', priority: 150, isSuper: false, allowNoise: true },
  // DP + KK
  { id: '623', steps: [
    { direction: 6, maxFrames: 7, matching: 'lenient' },
    { direction: 2, maxFrames: 7, matching: 'lenient' },
    { direction: 6, maxFrames: 7, matching: 'lenient' },
  ], buttonType: 'KK', priority: 150, isSuper: false, allowNoise: true },
  // HCB + PP
  { id: '63214', steps: [
    { direction: 6, maxFrames: 12, matching: 'optional' },
    { direction: 3, maxFrames: 12, matching: 'optional' },
    { direction: 2, maxFrames: 12, matching: 'optional' },
    { direction: 1, maxFrames: 12, matching: 'optional' },
    { direction: 4, maxFrames: 12, matching: 'strict' },
  ], buttonType: 'PP', priority: 150, isSuper: false, allowNoise: false, minOptionalCount: 3 },

  // --- Super Arts ---
  // Double QCF + K (SA1: e.g. Buster Wolf, Raging Spear)
  { id: '236236', steps: [
    { direction: 2, maxFrames: 12, matching: 'strict' },
    { direction: 3, maxFrames: 10, matching: 'optional' },
    { direction: 6, maxFrames: 12, matching: 'strict' },
    { direction: 2, maxFrames: 12, matching: 'strict' },
    { direction: 3, maxFrames: 10, matching: 'optional' },
    { direction: 6, maxFrames: 10, matching: 'strict' },
  ], buttonType: 'K', priority: 140, isSuper: true, allowNoise: true, minOptionalCount: 1 },
  // Double QCF + P (SA3: e.g. Hyper Bomb, Rising Fang)
  { id: '236236', steps: [
    { direction: 2, maxFrames: 12, matching: 'strict' },
    { direction: 3, maxFrames: 10, matching: 'optional' },
    { direction: 6, maxFrames: 12, matching: 'strict' },
    { direction: 2, maxFrames: 12, matching: 'strict' },
    { direction: 3, maxFrames: 10, matching: 'optional' },
    { direction: 6, maxFrames: 10, matching: 'strict' },
  ], buttonType: 'P', priority: 140, isSuper: true, allowNoise: true, minOptionalCount: 1 },
  // Double QCB + P (SA2: e.g. Sledgecross Hammer)
  { id: '214214', steps: [
    { direction: 2, maxFrames: 12, matching: 'strict' },
    { direction: 1, maxFrames: 10, matching: 'optional' },
    { direction: 4, maxFrames: 12, matching: 'strict' },
    { direction: 2, maxFrames: 12, matching: 'strict' },
    { direction: 1, maxFrames: 10, matching: 'optional' },
    { direction: 4, maxFrames: 10, matching: 'strict' },
  ], buttonType: 'P', priority: 140, isSuper: true, allowNoise: true, minOptionalCount: 1 },

  // --- DP (623) - higher than QC ---
  { id: '623', steps: [
    { direction: 6, maxFrames: 7, matching: 'lenient' },
    { direction: 2, maxFrames: 7, matching: 'lenient' },
    { direction: 6, maxFrames: 7, matching: 'lenient' },
  ], buttonType: 'K', priority: 70, isSuper: false, allowNoise: true },
  { id: '623', steps: [
    { direction: 6, maxFrames: 7, matching: 'lenient' },
    { direction: 2, maxFrames: 7, matching: 'lenient' },
    { direction: 6, maxFrames: 7, matching: 'lenient' },
  ], buttonType: 'P', priority: 70, isSuper: false, allowNoise: true },

  // --- QCF (236) ---
  { id: '236', steps: [
    { direction: 2, maxFrames: 11, matching: 'strict' },
    { direction: 3, maxFrames: 11, matching: 'strict' },
    { direction: 6, maxFrames: 11, matching: 'strict' },
  ], buttonType: 'P', priority: 60, isSuper: false, allowNoise: true },
  { id: '236', steps: [
    { direction: 2, maxFrames: 11, matching: 'strict' },
    { direction: 3, maxFrames: 11, matching: 'strict' },
    { direction: 6, maxFrames: 11, matching: 'strict' },
  ], buttonType: 'K', priority: 60, isSuper: false, allowNoise: true },

  // --- HCB (63214) ---
  { id: '63214', steps: [
    { direction: 6, maxFrames: 12, matching: 'optional' },
    { direction: 3, maxFrames: 12, matching: 'optional' },
    { direction: 2, maxFrames: 12, matching: 'optional' },
    { direction: 1, maxFrames: 12, matching: 'optional' },
    { direction: 4, maxFrames: 12, matching: 'strict' },
  ], buttonType: 'P', priority: 50, isSuper: false, allowNoise: false, minOptionalCount: 3 },
];

// Super Art motion prefixes (use generic P/K suffix)
const SUPER_PREFIXES = ['236236', '214214'];

// ===== Button Helpers =====
const PUNCH_BUTTONS: AttackButton[] = ['LP', 'MP', 'HP'];
const KICK_BUTTONS: AttackButton[] = ['LK', 'MK', 'HK'];

function hasPP(buttons: AttackButton[]): boolean {
  return buttons.filter(b => PUNCH_BUTTONS.includes(b)).length >= 2;
}

function hasKK(buttons: AttackButton[]): boolean {
  return buttons.filter(b => KICK_BUTTONS.includes(b)).length >= 2;
}

function buttonTypeMatches(buttons: AttackButton[], type: string): boolean {
  if (type === 'P') return buttons.some(b => PUNCH_BUTTONS.includes(b));
  if (type === 'K') return buttons.some(b => KICK_BUTTONS.includes(b));
  if (type === 'PP') return hasPP(buttons);
  if (type === 'KK') return hasKK(buttons);
  return false;
}

function getSpecificButton(buttons: AttackButton[], type: string): string {
  if (type === 'PP') return 'PP';
  if (type === 'KK') return 'KK';
  if (type === 'P') {
    if (buttons.includes('HP')) return 'HP';
    if (buttons.includes('MP')) return 'MP';
    if (buttons.includes('LP')) return 'LP';
  }
  if (type === 'K') {
    if (buttons.includes('HK')) return 'HK';
    if (buttons.includes('MK')) return 'MK';
    if (buttons.includes('LK')) return 'LK';
  }
  return '';
}

// ===== Direction Matching =====

// Strict: exact direction only
function strictMatch(actual: number, required: number): boolean {
  return actual === required;
}

// Lenient: diagonals also count for adjacent cardinals
// e.g., ↘(3) matches both ↓(2) and →(6); ↙(1) matches both ↓(2) and ←(4)
function lenientMatch(actual: number, required: number): boolean {
  if (actual === required) return true;
  // actual is a diagonal, check if it covers the required cardinal
  const diagonalCovers: Record<number, number[]> = {
    1: [2, 4],  // ↙ covers ↓ and ←
    3: [2, 6],  // ↘ covers ↓ and →
    7: [4, 8],  // ↖ covers ← and ↑
    9: [6, 8],  // ↗ covers → and ↑
  };
  // Also: cardinals can match adjacent diagonals
  // e.g., required=6(→), actual=3(↘) or 9(↗) → lenient match
  const cardinalCovers: Record<number, number[]> = {
    2: [1, 3],  // ↓ is covered by ↙ and ↘
    4: [1, 7],  // ← is covered by ↙ and ↖
    6: [3, 9],  // → is covered by ↘ and ↗
    8: [7, 9],  // ↑ is covered by ↖ and ↗
  };

  const covers = diagonalCovers[actual];
  if (covers && covers.includes(required)) return true;

  const coveredBy = cardinalCovers[required];
  if (coveredBy && coveredBy.includes(actual)) return true;

  return false;
}

function directionMatches(actual: number, required: number, mode: 'strict' | 'lenient'): boolean {
  if (mode === 'strict') return strictMatch(actual, required);
  return lenientMatch(actual, required);
}

// ===== Exhaustive Search Motion Matching =====
// SF6 uses exhaustive search: tries all possible subsequences of the direction history
// to find any valid match for the motion definition.

function exhaustiveMotionMatch(
  motion: MotionDef,
  history: DirectionEntry[],
  currentFrame: number,
): boolean {
  if (history.length === 0) return false;

  const steps = motion.steps;
  const requiredSteps = steps.filter(s => s.matching !== 'optional');
  if (requiredSteps.length === 0) return false;

  // For allowNoise=false (like dash), history entries must be consecutive matches
  // For allowNoise=true, we can skip unmatched entries

  let optionalMatched = 0;
  return backtrack(steps, 0, history, 0, -1, motion.allowNoise, motion.minOptionalCount || 0, { count: 0 });
}

function backtrack(
  steps: MotionStep[],
  stepIdx: number,
  history: DirectionEntry[],
  histIdx: number,
  prevFrame: number,  // frame of the previous matched entry (-1 if none)
  allowNoise: boolean,
  minOptional: number,
  optionalMatched: { count: number },
): boolean {
  // All steps matched
  if (stepIdx >= steps.length) {
    return optionalMatched.count >= minOptional;
  }

  const step = steps[stepIdx];

  // Option 1: If this step is optional, try skipping it
  if (step.matching === 'optional') {
    // Try skipping this optional step
    if (backtrack(steps, stepIdx + 1, history, histIdx, prevFrame, allowNoise, minOptional, optionalMatched)) {
      return true;
    }
  }

  // Option 2: Try to match this step against history entries
  for (let h = histIdx; h < history.length; h++) {
    const entry = history[h];

    // Check timing constraint: gap between previous match and this entry
    if (prevFrame >= 0 && step.maxFrames < 999) {
      const gap = entry.frame - prevFrame;
      if (gap > step.maxFrames) {
        // Too much time has passed — no point looking further
        break;
      }
    }

    // If noise not allowed, we can only use the very next entry (no skipping)
    if (!allowNoise && h > histIdx && step.matching !== 'optional') {
      break;
    }

    // Try to match this direction
    const matchMode = step.matching === 'optional' ? 'strict' : step.matching;
    if (directionMatches(entry.direction, step.direction, matchMode)) {
      // Matched! Track optional count
      const wasOptional = step.matching === 'optional';
      if (wasOptional) optionalMatched.count++;

      if (backtrack(steps, stepIdx + 1, history, h + 1, entry.frame, allowNoise, minOptional, optionalMatched)) {
        return true;
      }

      if (wasOptional) optionalMatched.count--;
    }
  }

  return false;
}

// ===== Public API =====
export type DetectResult = { moveId: string; moveName: string; isDriveRushCancel?: boolean };

export class CommandParser {
  private directionHistory: DirectionEntry[] = [];
  private maxHistoryFrames = 60;
  private lastDirection: Direction = 5;
  private characterData: CharacterData;

  // Motion consumption tracking
  private lastMotionConsumedFrame = 0;

  constructor(characterData: CharacterData) {
    this.characterData = characterData;
  }

  setCharacter(characterData: CharacterData): void {
    this.characterData = characterData;
    this.reset();
  }

  private findMoveById(id: string): MoveData | undefined {
    return this.characterData.moves.find(m => m.id === id);
  }

  // Record direction every frame
  recordDirection(direction: Direction, frame: number): void {
    if (direction !== this.lastDirection) {
      this.directionHistory.push({ direction, frame });
      this.lastDirection = direction;
    }
    this.directionHistory = this.directionHistory.filter(
      e => frame - e.frame < this.maxHistoryFrames
    );
  }

  // After a motion is detected, consume directions to prevent reuse
  // Double motions (236236, 214214) bypass this for the super shortcut
  consumeMotion(prefix: string, frame: number): void {
    this.lastMotionConsumedFrame = frame;
  }

  // ===== Main Detection =====
  detect(
    direction: Direction,
    pressedButtons: AttackButton[],
    frame: number,
    inCombo: boolean,
    lastMoveId?: string,
    lastWasDR?: boolean,
  ): DetectResult | null {
    if (pressedButtons.length === 0) return null;

    // 0. Target Combo detection (only when previous move directly connects, NOT after DR)
    if (inCombo && lastMoveId && !lastWasDR) {
      const tc = this.detectTargetCombo(lastMoveId, pressedButtons, direction);
      if (tc) return tc;
    }

    // 1. Motion commands (sorted by SF6 priority)
    const motion = this.detectMotion(pressedButtons, frame);
    if (motion) return motion;

    // 2. Drive Rush via 66 (double-tap forward) — only in combo context
    if (inCombo && this.detectDash66(frame)) {
      return { moveId: '66', moveName: 'Drive Rush Cancel (66)', isDriveRushCancel: true };
    }

    // 3. Prowler Stance: down + PP
    if ((direction === 2 || direction === 1 || direction === 3) && hasPP(pressedButtons)) {
      const move = this.findMoveById('2PP');
      if (move) return { moveId: move.id, moveName: move.name || move.input };
    }

    // 4. Drive Rush Cancel (MP+MK in combo) vs Drive Parry (MP+MK neutral)
    if (pressedButtons.includes('MP') && pressedButtons.includes('MK')) {
      if (inCombo) {
        return { moveId: '66', moveName: 'Drive Rush Cancel', isDriveRushCancel: true };
      } else {
        const move = this.findMoveById('MPMK');
        if (move) return { moveId: move.id, moveName: move.name || move.input };
      }
    }

    // 5. Drive Impact (HP+HK)
    if (pressedButtons.includes('HP') && pressedButtons.includes('HK')) {
      const move = this.findMoveById('HPHK');
      if (move) return { moveId: move.id, moveName: move.name || move.input };
    }

    // 6. Throw (LP+LK)
    if (pressedButtons.includes('LP') && pressedButtons.includes('LK')) {
      let throwId = 'LPLK';
      if (direction === 4) throwId = '4LPLK';
      else if (direction === 2 || direction === 1 || direction === 3) throwId = '2LPLK';
      const move = this.findMoveById(throwId);
      if (move) return { moveId: move.id, moveName: move.name || move.input };
    }

    // 7. Single-button normals / command normals
    return this.detectNormal(direction, pressedButtons);
  }

  // ===== Motion Detection (Exhaustive Search) =====
  private detectMotion(pressedButtons: AttackButton[], frame: number): DetectResult | null {
    // Sort by priority (highest first) — SF6 order
    const sorted = [...MOTIONS].sort((a, b) => b.priority - a.priority);

    for (const motionDef of sorted) {
      if (!buttonTypeMatches(pressedButtons, motionDef.buttonType)) continue;

      // Filter history: for super motions, use full history (enables 236P→236P = 236236P shortcut)
      // For single motions, only use entries after the last consumed frame
      const isDouble = SUPER_PREFIXES.includes(motionDef.id);
      const minFrame = isDouble ? 0 : this.lastMotionConsumedFrame;

      const relevantHistory = this.directionHistory.filter(e => e.frame > minFrame);
      if (relevantHistory.length === 0) continue;

      if (exhaustiveMotionMatch(motionDef, relevantHistory, frame)) {
        // Build the move ID
        let moveId: string;
        if (motionDef.isSuper) {
          moveId = motionDef.id + motionDef.buttonType; // 236236K, 236236P, 214214P
        } else {
          moveId = motionDef.id + getSpecificButton(pressedButtons, motionDef.buttonType);
        }

        const move = this.findMoveById(moveId);
        if (move) {
          return { moveId: move.id, moveName: move.name || move.input };
        }
      }
    }
    return null;
  }

  // ===== Dash Detection (66) =====
  // Strict: #(any) → →(1-8f) → #(1-8f) → →(any), no noise in between
  private detectDash66(frame: number): boolean {
    const hist = this.directionHistory;
    if (hist.length < 3) return false;

    // Search backwards for the pattern: neutral→forward→neutral→forward
    // We need exactly 4 consecutive entries matching this pattern
    for (let i = hist.length - 1; i >= 3; i--) {
      const e3 = hist[i];     // should be forward (current, any duration)
      const e2 = hist[i - 1]; // should be neutral (1-8f)
      const e1 = hist[i - 2]; // should be forward (1-8f)
      const e0 = hist[i - 3]; // should be neutral (any duration)

      // Check directions strictly
      if (!isFwd(e3.direction)) continue;
      if (e2.direction !== 5) continue;
      if (!isFwd(e1.direction)) continue;
      if (e0.direction !== 5) continue;

      // Check timing
      const gap1 = e1.frame - e0.frame; // neutral → forward: any
      const gap2 = e2.frame - e1.frame; // forward → neutral: 1-8f
      const gap3 = e3.frame - e2.frame; // neutral → forward: 1-8f

      if (gap2 >= 1 && gap2 <= 8 && gap3 >= 1 && gap3 <= 8) {
        // Check recency: last forward should be recent
        if (frame - e3.frame <= 5) return true;
      }
    }
    return false;
  }

  // ===== Target Combo Detection =====
  private detectTargetCombo(lastMoveId: string, pressedButtons: AttackButton[], direction: Direction): DetectResult | null {
    const allButtons: AttackButton[] = ['LP', 'MP', 'HP', 'LK', 'MK', 'HK'];
    for (const btn of allButtons) {
      if (!pressedButtons.includes(btn)) continue;

      const tcId = `${lastMoveId}~${btn}`;
      const move = this.findMoveById(tcId);
      if (move) return { moveId: move.id, moveName: move.name || move.input };

      if (direction === 2 || direction === 1 || direction === 3) {
        const tcIdDown = `${lastMoveId}~2${btn}`;
        const moveDown = this.findMoveById(tcIdDown);
        if (moveDown) return { moveId: moveDown.id, moveName: moveDown.name || moveDown.input };
      }
    }

    if (pressedButtons.includes('MP') && pressedButtons.includes('HP')) {
      const tcId = `${lastMoveId}~MP+HP`;
      const move = this.findMoveById(tcId);
      if (move) return { moveId: move.id, moveName: move.name || move.input };
    }

    return null;
  }

  // ===== Normal / Command Normal Detection =====
  private detectNormal(direction: Direction, pressedButtons: AttackButton[]): DetectResult | null {
    const btn = pressedButtons[0];
    let prefix = '';
    if (direction === 2 || direction === 1 || direction === 3) prefix = '2';
    else if (direction === 6) prefix = '6';
    else if (direction === 4) prefix = '4';
    else if (direction === 8 || direction === 7 || direction === 9) prefix = 'j.';
    else prefix = '5';

    // Command normals first (check if character has them)
    if (prefix === '6') {
      const cmdMove = this.findMoveById('6' + btn);
      if (cmdMove && cmdMove.category === 'command') return { moveId: cmdMove.id, moveName: cmdMove.name || cmdMove.input };
    }
    if (prefix === '4') {
      const cmdMove = this.findMoveById('4' + btn);
      if (cmdMove && cmdMove.category === 'command') return { moveId: cmdMove.id, moveName: cmdMove.name || cmdMove.input };
    }

    const moveId = prefix + btn;
    const move = this.findMoveById(moveId);
    if (move) return { moveId: move.id, moveName: move.name || move.input };

    return null;
  }

  // ===== Public Helpers =====
  findMove(moveId: string): MoveData | undefined {
    return this.findMoveById(moveId);
  }

  reset(): void {
    this.directionHistory = [];
    this.lastDirection = 5;
    this.lastMotionConsumedFrame = 0;
  }
}

// Helper: is this direction "forward" (6, 3, or 9)?
function isFwd(dir: number): boolean {
  return dir === 6;  // Dash requires strict forward, not diagonals
}
