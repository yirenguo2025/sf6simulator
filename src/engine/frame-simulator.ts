import { CharacterPhase, CharacterState, MoveData } from '../types';

export class FrameSimulator {
  private running = false;
  private frameCount = 0;
  private lastTime = 0;
  private accumulator = 0;
  private readonly FRAME_DURATION = 1000 / 60; // ~16.667ms
  private tickCallbacks: ((frame: number) => void)[] = [];
  private animId: number | null = null;

  // Character state tracking
  private state: CharacterState = {
    phase: 'idle',
    currentMove: null,
    frameInPhase: 0,
    totalPhaseFrames: 0,
    canCancel: false,
    canLink: false,
    isDriveRushing: false,
    driveGauge: 60000, // full 6 bars
    superGauge: 0,
  };

  onTick(cb: (frame: number) => void): void {
    this.tickCallbacks.push(cb);
  }

  getState(): CharacterState {
    return { ...this.state };
  }

  getFrame(): number {
    return this.frameCount;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  stop(): void {
    this.running = false;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  reset(): void {
    this.frameCount = 0;
    this.accumulator = 0;
    this.state = {
      phase: 'idle',
      currentMove: null,
      frameInPhase: 0,
      totalPhaseFrames: 0,
      canCancel: false,
      canLink: false,
      isDriveRushing: false,
      driveGauge: 60000,
      superGauge: 0,
    };
  }

  private loop = (time: number): void => {
    if (!this.running) return;

    const delta = time - this.lastTime;
    this.lastTime = time;
    this.accumulator += delta;

    // Process frames at 60fps
    while (this.accumulator >= this.FRAME_DURATION) {
      this.accumulator -= this.FRAME_DURATION;
      this.frameCount++;
      this.updateState();
      for (const cb of this.tickCallbacks) cb(this.frameCount);
    }

    this.animId = requestAnimationFrame(this.loop);
  };

  private updateState(): void {
    if (this.state.phase === 'idle') return;

    this.state.frameInPhase++;

    // Phase transitions
    if (this.state.currentMove) {
      const move = this.state.currentMove;
      const activeFrames = this.parseActiveFrames(move.active);
      const startup = move.startup;
      const recovery = move.recovery;

      if (this.state.phase === 'startup' && this.state.frameInPhase >= startup) {
        this.state.phase = 'active';
        this.state.frameInPhase = 0;
        this.state.totalPhaseFrames = activeFrames;
        this.state.canCancel = move.cancel !== '-';
      } else if (this.state.phase === 'active' && this.state.frameInPhase >= activeFrames) {
        this.state.phase = 'recovery';
        this.state.frameInPhase = 0;
        this.state.totalPhaseFrames = recovery;
        this.state.canCancel = false;
      } else if (this.state.phase === 'recovery' && this.state.frameInPhase >= recovery) {
        this.state.phase = 'idle';
        this.state.currentMove = null;
        this.state.frameInPhase = 0;
        this.state.canCancel = false;
        this.state.canLink = false;
      }
    }
  }

  // Execute a move (transition to startup phase)
  executeMove(move: MoveData): void {
    this.state.phase = 'startup';
    this.state.currentMove = move;
    this.state.frameInPhase = 0;
    this.state.totalPhaseFrames = move.startup;
    this.state.canCancel = false;
    this.state.canLink = false;
  }

  private parseActiveFrames(active: string): number {
    if (!active) return 1;
    // Handle multi-hit active frames like "2,5" -> total = 7
    const parts = active.split(',').map(s => parseInt(s.trim()));
    return parts.reduce((sum, n) => sum + (isNaN(n) ? 1 : n), 0);
  }
}
