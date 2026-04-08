import { MoveData, CharacterData, ComboState, ComboConnectionType } from '../types';
import { ComboEngine } from '../engine/combo-engine';

interface ChainEntry {
  move: MoveData;
  connectionType: ComboConnectionType | null;
  isValid: boolean;
  message: string;
  scaledDamage: number;
  scalingPercent: number;
}

// ===== Frame Bar Types =====
interface FrameSegment {
  type: 'startup' | 'active' | 'recovery' | 'hitstun';
  startFrame: number;
  duration: number;
  moveIndex: number;
  color: string;
}

interface TimelineData {
  p1Segments: FrameSegment[];
  p2Segments: FrameSegment[];
  totalP1Frames: number;
  totalP2Frames: number;
  moveLabels: { frame: number; input: string }[];
  headerStartup: number;
  headerTotal: number;
  headerAdv: string;
}

const FRAME_COLORS = {
  // P1 (Attacker)
  startup:    '#44cc66',  // Green
  active:     '#ff4466',  // Red/Pink
  recovery:   '#4488ff',  // Blue
  // P2 (Defender)
  hitstun:    '#ffcc00',  // Yellow
  // Special
  drDash:     '#aa66ff',  // Purple for Drive Rush
  // Grid
  cellBorder: 'rgba(10, 10, 15, 0.6)',
};

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  normal: 'Normals',
  command: 'Command',
  target_combo: 'Target Combo',
  special: 'Specials',
  prowler: 'Prowler',
  super: 'Super Arts',
  drive: 'Drive',
  throw: 'Throws',
};

export type CounterMode = 'off' | 'ch' | 'pc';

export class ComboBuilder {
  private moves: MoveData[] = [];
  private characterData: CharacterData;
  private currentCategory = 'all';
  private dragFromIndex = -1; // tracks which chain card is being dragged for reorder
  private counterMode: CounterMode = 'off';

  // DOM refs
  private chainEl: HTMLElement;
  private timelineCanvas: HTMLCanvasElement;
  private moveCardsEl: HTMLElement;
  private categoryTabsEl: HTMLElement;
  private statHitsEl: HTMLElement;
  private statDamageEl: HTMLElement;
  private statScalingEl: HTMLElement;
  private statDriveEl: HTMLElement;
  private statStatusEl: HTMLElement;
  private clearBtn: HTMLElement;
  private counterToggleEl: HTMLElement;

  constructor(characterData: CharacterData) {
    this.characterData = characterData;

    this.chainEl = document.getElementById('builder-chain')!;
    this.timelineCanvas = document.getElementById('builder-timeline') as HTMLCanvasElement;
    this.moveCardsEl = document.getElementById('builder-move-cards')!;
    this.categoryTabsEl = document.getElementById('builder-category-tabs')!;
    this.statHitsEl = document.getElementById('builder-stat-hits')!;
    this.statDamageEl = document.getElementById('builder-stat-damage')!;
    this.statScalingEl = document.getElementById('builder-stat-scaling')!;
    this.statDriveEl = document.getElementById('builder-stat-drive')!;
    this.statStatusEl = document.getElementById('builder-stat-status')!;
    this.clearBtn = document.getElementById('builder-clear')!;
    this.counterToggleEl = document.getElementById('builder-counter-toggle')!;

    this.setupDropZone();
    this.setupCounterToggle();
    this.clearBtn.addEventListener('click', () => this.clear());
    this.renderMoveList();
    this.renderChain();
  }

  setCharacter(data: CharacterData): void {
    this.characterData = data;
    this.clear();
    this.renderMoveList();
  }

  // ===== Counter hit toggle =====
  private setupCounterToggle(): void {
    this.counterToggleEl.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.counter as CounterMode;
        if (!mode) return;
        this.counterMode = mode;
        // Update active state
        this.counterToggleEl.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Re-run timeline
        this.update();
      });
    });
  }

  /** Get the hitstun bonus for the first hit based on counter mode. CH = +2, PC = +4. */
  private getCounterHitstunBonus(): number {
    switch (this.counterMode) {
      case 'ch': return 2;
      case 'pc': return 4;
      default: return 0;
    }
  }

  // ===== Drop zone setup =====
  private setupDropZone(): void {
    this.chainEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      this.chainEl.classList.add('drag-over');
    });

    this.chainEl.addEventListener('dragleave', (e) => {
      // Only remove if leaving the chain element itself
      if (e.relatedTarget && this.chainEl.contains(e.relatedTarget as Node)) return;
      this.chainEl.classList.remove('drag-over');
    });

    this.chainEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.chainEl.classList.remove('drag-over');

      const moveId = e.dataTransfer?.getData('text/plain');
      if (!moveId) return;

      // Check if this is a reorder (from chain) or new add (from palette)
      const fromIndex = e.dataTransfer?.getData('application/x-chain-index');

      // Find the insert position based on drop location
      const insertIndex = this.getInsertIndex(e);

      if (fromIndex !== undefined && fromIndex !== '') {
        // Reorder
        const from = parseInt(fromIndex);
        if (!isNaN(from)) {
          this.reorderMove(from, insertIndex);
        }
      } else {
        // New move from palette
        const move = this.characterData.moves.find(m => m.id === moveId);
        if (move) {
          this.addMoveAt(move, insertIndex);
        }
      }
    });
  }

  private getInsertIndex(e: DragEvent): number {
    // Find which chain-move card the drop is closest to
    const cards = this.chainEl.querySelectorAll('.chain-move');
    if (cards.length === 0) return 0;

    const dropX = e.clientX;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (dropX < midX) return i;
    }
    return this.moves.length; // Append at end
  }

  // ===== Core operations =====
  addMoveAt(move: MoveData, index: number): void {
    this.moves.splice(index, 0, move);
    this.update();
  }

  removeMove(index: number): void {
    this.moves.splice(index, 1);
    this.update();
  }

  reorderMove(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const move = this.moves.splice(fromIndex, 1)[0];
    // Adjust target index if needed
    const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
    this.moves.splice(adjustedTo, 0, move);
    this.update();
  }

  clear(): void {
    this.moves = [];
    this.update();
  }

  private update(): void {
    const result = this.validate();
    this.renderChain(result);
    this.renderTimeline(result);
    this.renderStats(result);
  }

  // ===== Validation =====
  private validate(): ChainEntry[] {
    if (this.moves.length === 0) return [];

    const engine = new ComboEngine();
    const entries: ChainEntry[] = [];
    const counterBonus = this.getCounterHitstunBonus();

    // Detect if combo starts with Drive Rush from Parry (MPMK~66)
    const startsWithDRParry = this.moves.length >= 2 && this.moves[0].id === 'MPMK~66';
    // The "effective first attack" index: skip DR if present
    const firstAttackIdx = startsWithDRParry ? 1 : 0;

    for (let i = 0; i < this.moves.length; i++) {
      let move = this.moves[i];

      // Skip DR Parry starter — don't feed it to ComboEngine at all.
      // Just record it in entries for the chain card display.
      if (startsWithDRParry && i === 0) {
        entries.push({
          move,
          connectionType: null,
          isValid: true,
          message: 'Drive Rush (from Parry)',
          scaledDamage: 0,
          scalingPercent: 100,
        });
        continue;
      }

      // Apply bonuses to the first real attack:
      // - Counter hit: CH +2, PC +4
      // - Drive Rush from Parry: +4 hitstun on the next attack
      if (i === firstAttackIdx && move.id !== 'MPMK~66') {
        let totalBonus = counterBonus;
        if (startsWithDRParry) totalBonus += 4;

        if (totalBonus > 0) {
          const origAdv = this.parseAdvantage(move.hitAdv);
          const newAdvNum = origAdv !== null ? origAdv + totalBonus : null;
          move = {
            ...move,
            hitstun: move.hitstun > 0 ? move.hitstun + totalBonus : move.hitstun,
            hitAdv: newAdvNum !== null ? (newAdvNum >= 0 ? `+${newAdvNum}` : `${newAdvNum}`) : move.hitAdv,
          };
        }
      }

      const result = engine.addMove(move);
      const combo = engine.getCombo();
      const hit = combo.hits[combo.hits.length - 1];

      // DR Parry → first attack: force as valid link
      let isValid = result.success;
      let connectionType = result.connectionType;
      if (startsWithDRParry && i === 1) {
        isValid = true;
        if (!connectionType) connectionType = 'link';
      }

      entries.push({
        move,
        connectionType,
        isValid,
        message: result.message,
        scaledDamage: hit ? hit.scaledDamage : move.damage,
        scalingPercent: hit ? hit.scalingPercent : 100,
      });
    }

    return entries;
  }

  // ===== Render chain (canvas area) =====
  private renderChain(entries?: ChainEntry[]): void {
    if (!entries || entries.length === 0) {
      this.chainEl.innerHTML = '<div class="drop-zone-empty">Drag moves here to build a combo</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Connector (between moves)
      if (i > 0) {
        const connClass = !entry.isValid ? 'invalid'
          : entry.connectionType === 'chain' || entry.connectionType === 'target_combo' ? 'chain-type'
          : entry.connectionType === 'dr_cancel' ? 'dr'
          : 'valid';
        const connLabel = !entry.isValid ? 'DROP'
          : entry.connectionType === 'chain' ? 'chain'
          : entry.connectionType === 'cancel' ? 'cancel'
          : entry.connectionType === 'link' ? 'link'
          : entry.connectionType === 'target_combo' ? 'TC'
          : entry.connectionType === 'dr_cancel' ? 'DR'
          : '?';

        html += `<div class="chain-connector ${connClass}">
          <div class="chain-connector-line"></div>
          <div class="chain-connector-label">${connLabel}</div>
        </div>`;
      }

      // Move card
      const advColor = (entry.move.hitAdv || '').startsWith('+') ? 'var(--accent-green)'
        : (entry.move.hitAdv || '').startsWith('-') ? 'var(--accent)' : 'var(--text-secondary)';

      html += `<div class="chain-move ${entry.isValid || i === 0 ? '' : 'invalid'}"
                    draggable="true"
                    data-index="${i}"
                    data-move-id="${entry.move.id}">
        <button class="chain-move-remove" data-index="${i}">&times;</button>
        <span class="chain-move-input">${entry.move.input}</span>
        <span class="chain-move-name">${entry.move.name || ''}</span>
        <div class="chain-move-info">
          <span style="color: var(--frame-startup);">${entry.move.startup}f</span>
          <span style="color: ${advColor};">${entry.move.hitAdv || '-'}</span>
          <span>${entry.scaledDamage}dmg</span>
          <span style="color: var(--text-secondary);">${entry.scalingPercent}%</span>
        </div>
      </div>`;
    }

    this.chainEl.innerHTML = html;

    // Wire up remove buttons
    this.chainEl.querySelectorAll('.chain-move-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index || '0');
        this.removeMove(idx);
      });
    });

    // Wire up chain cards: double-click to delete, drag to reorder
    this.chainEl.querySelectorAll('.chain-move').forEach(card => {
      // Double-click to delete
      card.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const idx = parseInt((card as HTMLElement).dataset.index || '0');
        this.removeMove(idx);
      });

      // Drag to reorder
      card.addEventListener('dragstart', (e) => {
        const el = card as HTMLElement;
        const evt = e as DragEvent;
        evt.dataTransfer!.setData('text/plain', el.dataset.moveId || '');
        evt.dataTransfer!.setData('application/x-chain-index', el.dataset.index || '');
        evt.dataTransfer!.effectAllowed = 'move';
        this.dragFromIndex = parseInt(el.dataset.index || '-1');
        setTimeout(() => el.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => {
        (card as HTMLElement).classList.remove('dragging');
        this.dragFromIndex = -1;
        // Remove all drag-over indicators
        this.chainEl.querySelectorAll('.chain-move').forEach(c => c.classList.remove('drag-left', 'drag-right'));
      });

      // Show drop indicator when dragging over chain cards
      card.addEventListener('dragover', (e) => {
        if (this.dragFromIndex < 0) return;
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = 'move';
        const rect = (card as HTMLElement).getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const isLeft = (e as DragEvent).clientX < midX;
        (card as HTMLElement).classList.toggle('drag-left', isLeft);
        (card as HTMLElement).classList.toggle('drag-right', !isLeft);
      });
      card.addEventListener('dragleave', () => {
        (card as HTMLElement).classList.remove('drag-left', 'drag-right');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        (card as HTMLElement).classList.remove('drag-left', 'drag-right');
        if (this.dragFromIndex < 0) return;

        const targetIdx = parseInt((card as HTMLElement).dataset.index || '0');
        const rect = (card as HTMLElement).getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const dropIdx = (e as DragEvent).clientX < midX ? targetIdx : targetIdx + 1;

        this.reorderMove(this.dragFromIndex, dropIdx);
        this.dragFromIndex = -1;
      });
    });
  }

  // ===== Frame bar helpers =====

  private parseActiveParts(active: string): number[] {
    if (!active) return [1];
    return active.split(',').map(s => parseInt(s.trim()) || 1);
  }

  /** Parse a hitAdv string like "+5", "-3", "KD +40" to a number (or null) */
  private parseAdvantage(adv: string): number | null {
    if (!adv) return null;
    const m = adv.match(/^([+-]?\d+)/);
    if (m) return parseInt(m[1]);
    const kdm = adv.match(/KD\s*([+-]?\d+)/);
    if (kdm) return parseInt(kdm[1]);
    const hkdm = adv.match(/HKD\s*([+-]?\d+)/);
    if (hkdm) return parseInt(hkdm[1]);
    return null;
  }

  /**
   * Calculate how many frames of the current move play out before the next move starts.
   *
   * IMPORTANT: In SF6, "startup N" means the Nth frame is the first active frame.
   * So the pre-hit frames = startup - 1, and the first active frame is part of "active".
   * The total for a move = (startup - 1) + active + recovery.
   *
   * For cancels, the move is truncated after active frames (recovery skipped).
   * For links, the move plays out fully.
   */
  private calculateCancelFrame(
    entry: ChainEntry,
    nextEntry: ChainEntry | undefined,
    preHitFrames: number,
    activeTotal: number,
    recovery: number,
  ): number {
    const fullTotal = preHitFrames + activeTotal + recovery;
    // Last move or next is invalid → full move
    if (!nextEntry || !nextEntry.isValid) return fullTotal;

    switch (nextEntry.connectionType) {
      case 'cancel':
      case 'chain':
      case 'target_combo':
      case 'dr_cancel':
        // Cancel: play pre-hit + active, skip recovery
        return preHitFrames + activeTotal;
      case 'link':
        // Link: full move plays out
        return fullTotal;
      default:
        return fullTotal;
    }
  }

  /**
   * Build the dual-bar timeline data from validated chain entries.
   * P1 = attacker's action frames, P2 = defender's stun frames.
   */
  private buildTimeline(entries: ChainEntry[]): TimelineData {
    const p1Segments: FrameSegment[] = [];
    const p2Segments: FrameSegment[] = [];
    const moveLabels: { frame: number; input: string }[] = [];

    let p1Frame = 0; // current P1 cursor

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const move = entry.move;
      const nextEntry = i < entries.length - 1 ? entries[i + 1] : undefined;

      const rawStartup = move.startup || 1;
      // SF6: "startup N" means Nth frame is first active. Pre-hit frames = N - 1.
      const preHitFrames = Math.max(rawStartup - 1, 0);
      const activeParts = this.parseActiveParts(move.active);
      const activeTotal = activeParts.reduce((a, b) => a + b, 0);
      const recovery = move.recovery || 1;

      // Skip Drive Rush from Parry when it's the combo starter — not shown on frame bar
      if (move.id === 'MPMK~66' && i === 0) {
        continue;
      }

      // Drive Rush (66) from cancel is a movement, not an attack
      if (move.id === '66') {
        const drFrames = move.total || 16;
        p1Segments.push({
          type: 'startup', startFrame: p1Frame, duration: drFrames,
          moveIndex: i, color: FRAME_COLORS.drDash,
        });
        moveLabels.push({ frame: p1Frame, input: 'DR' });
        p1Frame += drFrames;
        continue;
      }

      const cancelFrame = this.calculateCancelFrame(entry, nextEntry, preHitFrames, activeTotal, recovery);

      moveLabels.push({ frame: p1Frame, input: move.input });

      // === P1 segments ===
      let cursor = p1Frame;
      let remaining = cancelFrame;

      // Startup (pre-hit frames, green)
      const startupLen = Math.min(preHitFrames, remaining);
      if (startupLen > 0) {
        p1Segments.push({
          type: 'startup', startFrame: cursor, duration: startupLen,
          moveIndex: i, color: FRAME_COLORS.startup,
        });
        cursor += startupLen;
        remaining -= startupLen;
      }

      // Active (handle multi-hit parts)
      if (remaining > 0) {
        for (const partDur of activeParts) {
          const len = Math.min(partDur, remaining);
          if (len > 0) {
            p1Segments.push({
              type: 'active', startFrame: cursor, duration: len,
              moveIndex: i, color: FRAME_COLORS.active,
            });
            cursor += len;
            remaining -= len;
          }
          if (remaining <= 0) break;
        }
      }

      // Recovery (only if cancel didn't cut it)
      if (remaining > 0) {
        p1Segments.push({
          type: 'recovery', startFrame: cursor, duration: remaining,
          moveIndex: i, color: FRAME_COLORS.recovery,
        });
      }

      // === P2 segments: hitstun only (yellow), starts at hit frame ===
      if (entry.isValid || i === 0) {
        const hitFrame = p1Frame + preHitFrames; // hit connects on first active frame

        // Hitstun
        let hitstun = move.hitstun;
        if (hitstun <= 0) {
          // Estimate: hitstun = hitAdv + active + recovery
          // Because: hitAdv = hitstun - (active + recovery)
          const adv = this.parseAdvantage(move.hitAdv);
          if (adv !== null) {
            hitstun = adv + activeTotal + recovery;
          } else {
            hitstun = 16; // fallback
          }
        }
        // Note: counter hit and DR parry bonuses are already applied
        // to the move's hitstun in validate(), so no extra bonus here.
        p2Segments.push({
          type: 'hitstun', startFrame: hitFrame, duration: hitstun,
          moveIndex: i, color: FRAME_COLORS.hitstun,
        });
      }

      p1Frame += cancelFrame;
    }

    // Trim overlapping P2 segments (later hits override earlier hitstun)
    this.trimOverlappingSegments(p2Segments);

    // Header info: show the LAST move's data (matching SF6 training mode)
    // Frame advantage = hitstun - (active + recovery)
    const lastEntry = entries[entries.length - 1];
    const lastMove = lastEntry?.move;
    const headerStartup = lastMove?.startup || 0;
    const headerTotal = lastMove?.total || 0;

    // Compute displayed advantage from actual hitstun used
    // Note: entries already have bonuses (counter, DR parry) baked into move data from validate()
    let headerAdv = lastMove?.hitAdv || '-';
    if (lastMove) {
      const lastActiveParts = this.parseActiveParts(lastMove.active);
      const lastActiveTotal = lastActiveParts.reduce((a, b) => a + b, 0);
      const lastRecovery = lastMove.recovery || 0;
      let lastHistun = lastMove.hitstun;
      if (lastHistun <= 0) {
        const adv = this.parseAdvantage(lastMove.hitAdv);
        if (adv !== null) {
          lastHistun = adv + lastActiveTotal + lastRecovery;
        }
      }
      if (lastHistun > 0) {
        const advNum = lastHistun - (lastActiveTotal + lastRecovery);
        headerAdv = (advNum >= 0 ? '+' : '') + advNum;
      }
    }

    // Calculate total P2 frames
    let totalP2 = 0;
    for (const seg of p2Segments) {
      const end = seg.startFrame + seg.duration;
      if (end > totalP2) totalP2 = end;
    }

    return {
      p1Segments,
      p2Segments,
      totalP1Frames: p1Frame,
      totalP2Frames: totalP2,
      moveLabels,
      headerStartup,
      headerTotal,
      headerAdv,
    };
  }

  /** Trim overlapping P2 segments so later hits don't overlap with earlier hitstun */
  private trimOverlappingSegments(segments: FrameSegment[]): void {
    // Sort by startFrame
    segments.sort((a, b) => a.startFrame - b.startFrame);

    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      const currentEnd = current.startFrame + current.duration;

      // Find the next segment that starts after this one
      for (let j = i + 1; j < segments.length; j++) {
        const next = segments[j];
        if (next.startFrame < currentEnd) {
          // Trim current to end where next begins
          current.duration = Math.max(0, next.startFrame - current.startFrame);
        }
      }

      // Remove zero-duration segments
      if (current.duration <= 0) {
        segments.splice(i, 1);
        i--;
      }
    }
  }

  // ===== Render timeline =====

  /** Setup canvas for HiDPI/Retina displays. Returns the device pixel ratio used. */
  private setupHiDPICanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, logicalW: number, logicalH: number): number {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return dpr;
  }

  private renderTimeline(entries: ChainEntry[]): void {
    const ctx = this.timelineCanvas.getContext('2d');
    if (!ctx) return;

    const container = this.timelineCanvas.parentElement!;
    const containerRect = container.getBoundingClientRect();

    // Layout constants
    const PADDING = { left: 30, right: 10, top: 4, bottom: 4 };
    const HEADER_H = 16;
    const LABEL_H = 14;
    const BAR_H = 24;
    const BAR_GAP = 6;
    const LEGEND_H = 18;
    const MIN_CELL_W = 4;
    const MAX_CELL_W = 16;

    const totalHeight = PADDING.top + HEADER_H + LABEL_H + BAR_H + BAR_GAP + BAR_H + LEGEND_H + PADDING.bottom;

    // Empty state
    if (entries.length === 0) {
      this.setupHiDPICanvas(this.timelineCanvas, ctx, containerRect.width, containerRect.height);
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, containerRect.width, containerRect.height);
      ctx.fillStyle = '#8888a0';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Frame timeline appears here', containerRect.width / 2, containerRect.height / 2);
      return;
    }

    // Build timeline data
    const timeline = this.buildTimeline(entries);
    const totalFrames = Math.max(timeline.totalP1Frames, timeline.totalP2Frames);
    if (totalFrames === 0) return;

    // Calculate cell width
    const availableWidth = containerRect.width - PADDING.left - PADDING.right;
    let cellW = Math.floor(availableWidth / totalFrames);
    cellW = Math.max(MIN_CELL_W, Math.min(MAX_CELL_W, cellW));

    // Canvas logical sizing (expand for horizontal scroll if needed)
    const neededWidth = totalFrames * cellW + PADDING.left + PADDING.right;
    const logicalW = Math.max(containerRect.width, neededWidth);
    const logicalH = Math.max(containerRect.height, totalHeight);

    // Setup HiDPI canvas
    this.setupHiDPICanvas(this.timelineCanvas, ctx, logicalW, logicalH);

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, logicalW, logicalH);

    const startX = PADDING.left;

    // Y positions
    const headerY = PADDING.top + HEADER_H - 3;
    const labelY = PADDING.top + HEADER_H + LABEL_H - 2;
    const p1BarY = PADDING.top + HEADER_H + LABEL_H;
    const p2BarY = p1BarY + BAR_H + BAR_GAP;
    const legendY = p2BarY + BAR_H + LEGEND_H - 2;

    // --- Header text ---
    ctx.fillStyle = '#8888a0';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(
      `发生 ${timeline.headerStartup}f / 总计 ${timeline.headerTotal}f / 硬直差 ${timeline.headerAdv}`,
      startX, headerY,
    );

    // --- Move labels above P1 bar ---
    ctx.fillStyle = '#e8e8f0';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    for (const lbl of timeline.moveLabels) {
      ctx.fillText(lbl.input, startX + lbl.frame * cellW + 1, labelY);
    }

    // --- P1 bar label ---
    ctx.fillStyle = '#666680';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('P1', startX - 4, p1BarY + BAR_H / 2 + 4);

    // --- Draw P1 segments ---
    this.drawBarSegments(ctx, timeline.p1Segments, p1BarY, BAR_H, cellW, startX, entries);

    // --- P2 bar label ---
    ctx.fillStyle = '#666680';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('P2', startX - 4, p2BarY + BAR_H / 2 + 4);

    // --- Draw P2 segments ---
    this.drawBarSegments(ctx, timeline.p2Segments, p2BarY, BAR_H, cellW, startX, entries);

    // --- Cancel point indicators ---
    this.drawCancelIndicators(ctx, entries, timeline, p1BarY, BAR_H, BAR_GAP, cellW, startX);

    // --- Legend ---
    ctx.globalAlpha = 1;
    const legends = [
      { color: FRAME_COLORS.startup,  label: 'Startup' },
      { color: FRAME_COLORS.active,   label: 'Active' },
      { color: FRAME_COLORS.recovery, label: 'Recovery' },
      { color: FRAME_COLORS.hitstun,  label: 'Hitstun' },
    ];
    let lx = startX;
    ctx.font = '10px system-ui';
    for (const l of legends) {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, legendY - 8, 8, 8);
      ctx.fillStyle = '#8888a0';
      ctx.textAlign = 'left';
      ctx.fillText(l.label, lx + 11, legendY);
      lx += 72;
    }
  }

  /** Draw frame segments as solid colored blocks with black number labels. No per-frame grid lines. */
  private drawBarSegments(
    ctx: CanvasRenderingContext2D,
    segments: FrameSegment[],
    barY: number,
    barH: number,
    cellW: number,
    startX: number,
    entries: ChainEntry[],
  ): void {
    for (const seg of segments) {
      if (seg.duration <= 0) continue;
      const x = startX + seg.startFrame * cellW;
      const w = seg.duration * cellW;

      // Check validity (first move always valid)
      const isValid = seg.moveIndex === 0 || entries[seg.moveIndex]?.isValid;
      ctx.globalAlpha = isValid ? 1.0 : 0.3;

      // Fill segment as one solid block
      ctx.fillStyle = seg.color;
      ctx.fillRect(x, barY, w, barH);

      // Frame count number inside segment (black text, only if enough space)
      if (w >= 14 && seg.duration > 0) {
        ctx.globalAlpha = isValid ? 1.0 : 0.3;
        ctx.fillStyle = '#000000';
        const fontSize = Math.min(13, barH - 6);
        ctx.font = `bold ${fontSize}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          seg.duration.toString(),
          x + w / 2,
          barY + barH / 2,
        );
        ctx.textBaseline = 'alphabetic'; // reset
      }
    }
    ctx.globalAlpha = 1.0;
  }

  /** Draw dashed vertical lines at cancel points between moves */
  private drawCancelIndicators(
    ctx: CanvasRenderingContext2D,
    entries: ChainEntry[],
    timeline: TimelineData,
    p1BarY: number,
    barH: number,
    barGap: number,
    cellW: number,
    startX: number,
  ): void {
    // Find cancel points by looking at where consecutive move labels are
    for (let i = 1; i < timeline.moveLabels.length; i++) {
      const entry = entries[i];
      if (!entry || !entry.isValid) continue;

      const connType = entry.connectionType;
      if (connType === 'cancel' || connType === 'chain' || connType === 'target_combo' || connType === 'dr_cancel') {
        const cutFrame = timeline.moveLabels[i].frame;
        const cutX = startX + cutFrame * cellW;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cutX, p1BarY - 2);
        ctx.lineTo(cutX, p1BarY + barH + 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // ===== Render stats =====
  private renderStats(entries: ChainEntry[]): void {
    if (entries.length === 0) {
      this.statHitsEl.textContent = '0';
      this.statDamageEl.textContent = '0';
      this.statScalingEl.textContent = '100%';
      this.statDriveEl.textContent = '0';
      this.statStatusEl.textContent = 'READY';
      this.statStatusEl.className = 'stat-value valid';
      return;
    }

    // Use the already-validated entries (which have DR Parry and counter bonuses applied)
    let allValid = true;
    let lastDropIdx = -1;
    let totalDamage = 0;
    let hitCount = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // Skip DR Parry starter — it's not an attack
      if (entry.move.id === 'MPMK~66' && i === 0) continue;

      hitCount++;
      totalDamage += entry.scaledDamage;
      if (!entry.isValid && i > 0) {
        allValid = false;
        lastDropIdx = i;
      }
    }

    const lastEntry = entries[entries.length - 1];
    this.statHitsEl.textContent = hitCount.toString();
    this.statDamageEl.textContent = totalDamage.toString();
    this.statScalingEl.textContent = `${lastEntry.scalingPercent}%`;
    this.statDriveEl.textContent = '0'; // TODO: track drive gauge from entries

    if (allValid) {
      this.statStatusEl.textContent = 'COMBO';
      this.statStatusEl.className = 'stat-value valid';
    } else {
      this.statStatusEl.textContent = `DROP @ ${lastDropIdx + 1}`;
      this.statStatusEl.className = 'stat-value invalid';
    }
  }

  // ===== Render move list (right panel) =====
  renderMoveList(): void {
    // Category tabs
    const categories = new Set<string>();
    categories.add('all');
    for (const m of this.characterData.moves) {
      categories.add(m.category);
    }

    this.categoryTabsEl.innerHTML = Array.from(categories).map(cat =>
      `<span class="filter-btn ${this.currentCategory === cat ? 'active' : ''}" data-cat="${cat}">${CATEGORY_LABELS[cat] || cat}</span>`
    ).join('');

    this.categoryTabsEl.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentCategory = (btn as HTMLElement).dataset.cat || 'all';
        this.renderMoveList();
      });
    });

    // Move cards
    const filtered = this.currentCategory === 'all'
      ? this.characterData.moves
      : this.characterData.moves.filter(m => m.category === this.currentCategory);

    this.moveCardsEl.innerHTML = filtered.map(m => {
      const advColor = (m.hitAdv || '').startsWith('+') ? 'var(--accent-green)'
        : (m.hitAdv || '').startsWith('-') ? 'var(--accent)' : 'var(--text-secondary)';

      return `<div class="move-card" draggable="true" data-move-id="${m.id}">
        <div class="move-card-left">
          <span class="move-card-input">${m.input}</span>
          <span class="move-card-name">${m.name || ''}</span>
        </div>
        <div class="move-card-right">
          <span class="move-card-startup">${m.startup || '-'}f</span>
          <span class="move-card-adv" style="color: ${advColor};">${m.hitAdv || '-'} / ${m.blockAdv || '-'}</span>
          <span class="move-card-dmg">${m.damage || '-'} dmg</span>
        </div>
      </div>`;
    }).join('');

    // Wire up drag
    this.moveCardsEl.querySelectorAll('.move-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        const el = card as HTMLElement;
        const evt = e as DragEvent;
        evt.dataTransfer!.setData('text/plain', el.dataset.moveId || '');
        evt.dataTransfer!.effectAllowed = 'copy';
        el.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        (card as HTMLElement).classList.remove('dragging');
      });
      // Double-click: append move to end of chain
      card.addEventListener('dblclick', () => {
        const moveId = (card as HTMLElement).dataset.moveId;
        if (!moveId) return;
        const move = this.characterData.moves.find(m => m.id === moveId);
        if (move) {
          this.addMoveAt(move, this.moves.length);
        }
      });
    });
  }
}
