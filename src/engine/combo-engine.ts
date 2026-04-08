import { CharacterPhase, CharacterState, MoveData, ComboState, ComboConnectionType, ComboHit } from '../types';
import { DamageCalculator } from './damage-calculator';

const INPUT_BUFFER_FRAMES = 4; // SF6 universal input buffer: can buffer 4f early (5f total window)

// Parse hitAdv string to get numeric frame advantage
function parseAdvantage(adv: string): number | null {
  if (!adv) return null;
  const match = adv.match(/^([+-]?\d+)/);
  if (match) return parseInt(match[1]);
  const kdMatch = adv.match(/KD\s*([+-]?\d+)/);
  if (kdMatch) return parseInt(kdMatch[1]);
  const hkdMatch = adv.match(/HKD\s*([+-]?\d+)/);
  if (hkdMatch) return parseInt(hkdMatch[1]);
  return null;
}

// Parse the active frames string to get the total count of the first hit
function parseFirstActiveFrames(active: string): number {
  if (!active) return 1;
  // "2,5" -> first hit has 2 active frames; "3" -> 3
  const first = active.split(',')[0].trim();
  const n = parseInt(first);
  return isNaN(n) ? 1 : n;
}

// ============================================================
// COMBO CONNECTION LOGIC
// ============================================================
//
// KEY PRINCIPLE: We assume the opponent is ALWAYS holding block.
// A combo only connects if the next move's active frame arrives
// BEFORE the opponent's hitstun from the previous move expires.
//
// --- CANCEL ---
// When you cancel move A into move B, you skip A's remaining
// active frames and recovery, going straight into B's startup.
// The opponent is still in hitstun from move A's hit.
//
// Cancel combo connects if: B.startup <= A.hitstun
//   (because you cancel on the hit frame, so opponent has
//    A.hitstun frames of stun remaining, and B needs B.startup
//    frames to become active)
//
// --- LINK ---
// You let move A fully complete (startup + active + recovery),
// then input move B. The opponent recovers from hitstun at
// the same time you recover from your move, offset by hitAdv.
//
// Link combo connects if: B.startup <= A.hitAdv
//
// --- CHAIN ---
// Chains (light ~ light) always combo in SF6; the engine
// handles the hitstun specially to guarantee the connection.
//
// --- TARGET COMBO ---
// Hardcoded sequences that always combo.
// ============================================================

// Check if fromMove's cancel property allows canceling into toMove
function getCancelType(fromMove: MoveData, toMove: MoveData): ComboConnectionType | null {
  const cancelProp = fromMove.cancel;
  if (cancelProp === '-' || !cancelProp) return null;

  const parts = cancelProp.split(/\s+/);

  // Chain cancel (Chn) - only chains into specific light normals: 5LP, 2LP, 2LK
  // NOT 5LK or any other light. This is explicitly stated in the wiki frame data.
  const CHAIN_TARGETS = ['5LP', '2LP', '2LK'];
  if (parts.includes('Chn') && CHAIN_TARGETS.includes(toMove.id)) {
    return 'chain';
  }

  // Target combo (TC)
  if (parts.includes('TC')) {
    if (fromMove.id === '5MP' && toMove.id === '5MP~HP') return 'target_combo';
    if (fromMove.id === '2LK' && toMove.id === '2LK~2HK') return 'target_combo';
    if (fromMove.id === '2PP~HK' && toMove.id === '2PP~HK~HK') return 'target_combo';
  }

  // Special cancel (Sp) - includes specials, prowler, and Drive Rush cancel
  if (parts.includes('Sp')) {
    if (toMove.category === 'special' || toMove.category === 'prowler') {
      return 'cancel';
    }
    // Drive Rush Cancel (66) is available from any Sp-cancelable move
    if (toMove.id === '66') {
      return 'dr_cancel';
    }
  }

  // Super cancel (SA / SA2 / SA3)
  // "SA" in cancel string = can cancel into any SA level
  // "SA2" = only SA2, "SA3" = only SA3
  if (toMove.category === 'super') {
    const canSA1 = parts.includes('SA') || parts.includes('SA1');
    const canSA2 = parts.includes('SA') || parts.includes('SA2');
    const canSA3 = parts.includes('SA') || parts.includes('SA3');

    // Determine which SA level the target move is
    const isSA1 = toMove.id === '236236K';
    const isSA2 = toMove.id === '214214P' || toMove.id === 'SA2_followup';
    const isSA3 = toMove.id === '236236P' || toMove.id === '236236P_CA';

    if ((isSA1 && canSA1) || (isSA2 && canSA2) || (isSA3 && canSA3)) {
      return 'cancel';
    }
    // If "SA" is in the list, allow any
    if (parts.includes('SA')) return 'cancel';
  }

  // Prowler Stance cancel (PS or PS*)
  // PS = can cancel on hit or block
  // PS* = can cancel on HIT only (our simulator assumes on-hit for combos, so both work)
  if ((parts.includes('PS') || parts.includes('PS*')) && toMove.id === '2PP') {
    return 'cancel';
  }

  // Also allow canceling into Prowler Stance follow-up moves directly
  // (e.g., 2HP > 2PP is the stance entry, then stance moves follow)
  if ((parts.includes('PS') || parts.includes('PS*')) && toMove.category === 'prowler') {
    return 'cancel';
  }

  return null;
}

// Check if a cancel actually forms a true combo (not just that the cancel is allowed)
// isDriveRush: whether the fromMove was performed after a Drive Rush (affects hitstun)
function doesCancelCombo(fromMove: MoveData, toMove: MoveData, cancelType: ComboConnectionType, isDriveRush: boolean): { combos: boolean; message: string } {
  // Chains, Target Combos, and Drive Rush Cancels always succeed
  if (cancelType === 'chain' || cancelType === 'target_combo' || cancelType === 'dr_cancel') {
    return { combos: true, message: `${cancelType}: ${fromMove.input} > ${toMove.input}` };
  }

  // For special/super cancel: check if toMove.startup <= opponent's hitstun
  // When you cancel on the hit frame, the opponent has hitstun frames remaining.
  let hitstun = fromMove.hitstun;

  if (isDriveRush) {
    // After Drive Rush, normals/command normals get +4 frame advantage,
    // which means more hitstun. Use drCancelOnHit + recovery to estimate.
    const drAdv = parseAdvantage(fromMove.drCancelOnHit);
    if (drAdv !== null && fromMove.recovery > 0) {
      hitstun = drAdv + fromMove.recovery;
    } else if (hitstun > 0) {
      // Fallback: add 4 to existing hitstun
      hitstun += 4;
    }
  }

  if (hitstun <= 0) {
    // Estimate: hitstun = hitAdv + recovery
    const advStr = isDriveRush ? (fromMove.afterDrOnHit || fromMove.hitAdv) : fromMove.hitAdv;
    const adv = parseAdvantage(advStr);
    if (adv !== null && fromMove.recovery > 0) {
      hitstun = adv + fromMove.recovery;
    }
  }

  if (hitstun <= 0) {
    if (isKnockdown(fromMove.hitAdv)) {
      return { combos: true, message: `cancel combo (KD): ${fromMove.input} > ${toMove.input}` };
    }
    return { combos: false, message: `cancel allowed but no hitstun data for ${fromMove.input}` };
  }

  const toStartup = toMove.startup;
  if (toStartup <= hitstun) {
    const window = hitstun - toStartup + 1;
    const drNote = isDriveRush ? ' [after DR]' : '';
    return { combos: true, message: `cancel combo (${window}f window): ${fromMove.input} > ${toMove.input} [startup ${toStartup}f <= hitstun ${hitstun}f${drNote}]` };
  }

  return {
    combos: false,
    message: `cancel allowed but NOT a combo: ${fromMove.input} > ${toMove.input} [startup ${toStartup}f > hitstun ${hitstun}f, opponent can block]`,
  };
}

// Check if a link combo is possible (no cancel, wait for full recovery)
// The link is a true combo if: startup <= hitAdv (opponent is still in hitstun)
// SF6 input buffer makes the EXECUTION easier (4f early input window),
// but does NOT make non-combos into combos. A link that is -1 on paper is still not a combo.
function canLink(fromMove: MoveData, toMove: MoveData, isDriveRush: boolean): { canLink: boolean; window: number; message: string } {
  let advStr: string;
  let drBonus = 0;

  if (isDriveRush) {
    // Use afterDrOnHit if available, otherwise fall back to hitAdv
    advStr = fromMove.afterDrOnHit || fromMove.hitAdv;
    // Drive Rush gives +4 bonus to normal and command normal attacks
    if (toMove.category === 'normal' || toMove.category === 'command') {
      drBonus = 4;
    }
  } else {
    advStr = fromMove.hitAdv;
  }

  const adv = parseAdvantage(advStr);
  if (adv === null) return { canLink: false, window: 0, message: 'no hitAdv data' };

  const effectiveAdv = adv + drBonus;
  const startup = toMove.startup;
  // True combo check: does the move connect before opponent exits hitstun?
  // window = hitAdv - startup + 1 (must be >= 1 for a true combo, 0 = frame-perfect)
  const window = effectiveAdv - startup + 1;

  if (window >= 0) {
    // Input buffer makes execution easier (5f total window for a 1f link)
    // but the link itself must be valid first
    const executionWindow = window + INPUT_BUFFER_FRAMES;
    const drNote = drBonus > 0 ? ` [DR+${drBonus}]` : '';
    return { canLink: true, window: executionWindow, message: `link (${window}f true, ${executionWindow}f with buffer): ${fromMove.input} , ${toMove.input} [startup ${startup}f, adv +${effectiveAdv}f${drNote}]` };
  }

  return { canLink: false, window: 0, message: `link fails: ${fromMove.input} , ${toMove.input} [startup ${startup}f > adv +${effectiveAdv}f, gap ${-window}f]` };
}

// Check if a move's hit advantage indicates a knockdown (combo ender)
function isKnockdown(hitAdv: string): boolean {
  if (!hitAdv) return false;
  return /\bKD\b/.test(hitAdv) || /\bHKD\b/.test(hitAdv);
}

function toMoveStr(move: MoveData): string {
  return move.name ? `${move.input} (${move.name})` : move.input;
}

export class ComboEngine {
  private dmgCalc = new DamageCalculator();
  private comboMoves: { move: MoveData; connectionType: ComboConnectionType | null; isDriveRush: boolean }[] = [];
  private combo: ComboState = this.emptyCombo();
  private isDriveRushing = false;
  private listeners: ((combo: ComboState) => void)[] = [];

  // Combo input timeout: how long (in frames) after the last move before
  // we consider the combo "finished". This is generous because the user
  // is typing on a keyboard, not playing frame-perfect. The combo engine
  // already validates whether each move actually connects — this timer
  // just detects "the user stopped inputting".
  private static readonly COMBO_INPUT_TIMEOUT = 45; // 0.75 seconds at 60fps

  private timeoutRemaining = 0;
  private comboActive = false;

  private emptyCombo(): ComboState {
    return {
      hits: [],
      totalDamage: 0,
      hitCount: 0,
      isValid: true,
      driveGaugeUsed: 0,
      superGaugeUsed: 0,
      currentScaling: 1.0,
      endReason: 'active',
    };
  }

  onComboUpdate(cb: (combo: ComboState) => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.combo);
  }

  getCombo(): ComboState {
    return this.combo;
  }

  isComboActive(): boolean {
    return this.comboActive;
  }

  // Called every frame by the frame simulator.
  tick(): void {
    if (!this.comboActive || this.comboMoves.length === 0) return;

    if (this.timeoutRemaining > 0) {
      this.timeoutRemaining--;
    }

    if (this.timeoutRemaining <= 0 && this.comboActive) {
      // Timeout expired, no new move was input → combo completed naturally
      const notation = this.comboMoves.map(e => e.move.input).join(' > ');

      this.combo.endReason = 'completed';
      this.combo.completionInfo = `${notation} | ${this.combo.hitCount} hit(s), ${this.combo.totalDamage} damage`;
      this.comboActive = false;
      this.emit();

      this.comboMoves = [];
      this.isDriveRushing = false;
    }
  }

  getHitstunRemaining(): number {
    return this.timeoutRemaining;
  }

  // Reset the input timeout (called each time a move is added to the combo)
  private resetTimeout(): void {
    this.timeoutRemaining = ComboEngine.COMBO_INPUT_TIMEOUT;
  }

  // Add a move to the combo and check if it connects
  addMove(move: MoveData): { success: boolean; connectionType: ComboConnectionType | null; message: string } {
    // If the previous combo completed or was knocked down, start fresh
    if (this.combo.endReason === 'completed' || this.combo.endReason === 'dropped') {
      this.reset();
    }

    // If the previous move caused a knockdown, the combo is over.
    if (this.comboMoves.length > 0) {
      const lastMove = this.comboMoves[this.comboMoves.length - 1].move;
      if (isKnockdown(lastMove.hitAdv)) {
        // Save completion info before reset
        const notation = this.comboMoves.map(e => e.move.input).join(' > ');
        const info = `${notation} | ${this.combo.hitCount} hit(s), ${this.combo.totalDamage} damage`;
        this.reset();
        this.combo.endReason = 'completed';
        this.combo.completionInfo = info;
        this.emit();
        // Now start a new combo below
      }
    }

    // If hitstun already expired but we haven't ticked yet, the old combo is done
    if (this.comboActive && this.timeoutRemaining <= 0 && this.comboMoves.length > 0) {
      const notation = this.comboMoves.map(e => e.move.input).join(' > ');
      const info = `${notation} | ${this.combo.hitCount} hit(s), ${this.combo.totalDamage} damage`;
      this.reset();
      this.combo.endReason = 'completed';
      this.combo.completionInfo = info;
      this.emit();
    }

    if (this.comboMoves.length === 0) {
      // First move in combo - always succeeds (we assume it hits)
      this.comboMoves.push({ move, connectionType: null, isDriveRush: false });
      this.comboActive = true;
      this.resetTimeout();
      this.recalculate();
      this.combo.endReason = 'active';
      this.emit();
      return { success: true, connectionType: null, message: `${move.input} (starter)` };
    }

    const lastEntry = this.comboMoves[this.comboMoves.length - 1];
    const lastMove = lastEntry.move;

    // For combo logic, the "effective last move" is the last actual ATTACK,
    // not Drive Rush (which is just a movement cancel, not a hit).
    // Walk back through the combo to find the last real attack.
    let effectiveLastEntry = lastEntry;
    let effectiveLastMove = lastMove;
    for (let i = this.comboMoves.length - 1; i >= 0; i--) {
      if (this.comboMoves[i].move.id !== '66') {
        effectiveLastEntry = this.comboMoves[i];
        effectiveLastMove = this.comboMoves[i].move;
        break;
      }
    }

    // Check Drive Rush (special case - not a hit, just a movement cancel)
    // DR cancel requires the previous move to have Sp cancel property
    if (move.id === '66') {
      const drCancelType = getCancelType(effectiveLastMove, move);
      if (drCancelType === 'dr_cancel') {
        this.isDriveRushing = true;
        this.comboMoves.push({ move, connectionType: 'dr_cancel', isDriveRush: true });
        this.resetTimeout();
        this.recalculate();
        return { success: true, connectionType: 'dr_cancel', message: `Drive Rush Cancel from ${effectiveLastMove.input}` };
      }
      // DR cancel not allowed from this move — treat as drop
      const dropInfo = `Cannot Drive Rush Cancel from ${effectiveLastMove.input} (no cancel property)`;
      this.reset();
      this.combo.endReason = 'dropped';
      this.combo.dropInfo = dropInfo;
      this.emit();
      return { success: false, connectionType: null, message: dropInfo };
    }

    // Step 1: Check if cancel is ALLOWED from the effective last attack
    const cancelType = getCancelType(effectiveLastMove, move);

    if (cancelType !== null) {
      const cancelComboResult = doesCancelCombo(effectiveLastMove, move, cancelType, this.isDriveRushing || effectiveLastEntry.isDriveRush);

      if (cancelComboResult.combos) {
        // True combo via cancel
        this.comboMoves.push({ move, connectionType: cancelType, isDriveRush: this.isDriveRushing });
        if (cancelType !== 'dr_cancel') this.isDriveRushing = false;
        this.resetTimeout();
        this.recalculate();
        this.combo.endReason = 'active';
        this.emit();
        return { success: true, connectionType: cancelType, message: cancelComboResult.message };
      }
    }

    // Step 2: Check link (use effective last attack, and check DR state)
    const wasDR = effectiveLastEntry.isDriveRush || this.isDriveRushing;
    const linkResult = canLink(effectiveLastMove, move, wasDR);
    if (linkResult.canLink) {
      this.comboMoves.push({ move, connectionType: 'link', isDriveRush: this.isDriveRushing });
      this.isDriveRushing = false;
      this.resetTimeout();
      this.recalculate();
      this.combo.endReason = 'active';
      this.emit();
      return { success: true, connectionType: 'link', message: linkResult.message };
    }

    // Step 3: Combo dropped
    const lastHitAdv = parseAdvantage(wasDR ? (effectiveLastMove.afterDrOnHit || effectiveLastMove.hitAdv) : effectiveLastMove.hitAdv);
    const drBonus = (wasDR && (move.category === 'normal' || move.category === 'command')) ? 4 : 0;
    const effectiveAdv = lastHitAdv !== null ? lastHitAdv + drBonus : null;
    const frameDiff = effectiveAdv !== null ? effectiveAdv - move.startup : null;
    const frameInfo = frameDiff !== null ? `${frameDiff >= 0 ? '+' : ''}${frameDiff}` : '??';

    const dropInfo = `Combo dropped at ${effectiveLastMove.input} > ${move.input}, frame disadvantage: ${frameInfo}f`;

    // Save the dropped combo info
    const prevDamage = this.combo.totalDamage;
    const prevHits = this.combo.hitCount;

    this.reset();
    this.combo.endReason = 'dropped';
    this.combo.dropInfo = dropInfo;
    this.emit();

    // Start fresh combo with the new move
    this.comboMoves.push({ move, connectionType: null, isDriveRush: false });
    this.comboActive = true;
    this.resetTimeout();
    this.recalculate();
    // Keep the drop info visible
    this.combo.endReason = 'dropped';
    this.combo.dropInfo = dropInfo;
    this.emit();

    return { success: false, connectionType: null, message: dropInfo };
  }

  // Validate a preset combo sequence
  validateCombo(moveIds: string[], allMoves: MoveData[]): ComboState {
    const saved = [...this.comboMoves];
    const savedDR = this.isDriveRushing;

    this.reset();
    for (const id of moveIds) {
      const move = allMoves.find(m => m.id === id);
      if (move) this.addMove(move);
    }
    const result = { ...this.combo };

    // Restore state
    this.comboMoves = saved;
    this.isDriveRushing = savedDR;
    this.recalculate();

    return result;
  }

  private recalculate(): void {
    this.combo = this.dmgCalc.calculateCombo(this.comboMoves);
    // Preserve endReason (don't overwrite it)
  }

  reset(): void {
    this.comboMoves = [];
    this.isDriveRushing = false;
    this.comboActive = false;
    this.timeoutRemaining = 0;
    this.combo = this.emptyCombo();
    this.emit();
  }

  getComboMoves(): typeof this.comboMoves {
    return [...this.comboMoves];
  }
}
