import { AttackButton, Direction, InputEvent, KeyBindings, DEFAULT_KEYBINDINGS } from '../types';

type InputCallback = (event: InputEvent) => void;

export class InputManager {
  private bindings: KeyBindings;
  private heldKeys = new Set<string>();
  private currentDirection: Direction = 5;
  private currentButtons = new Set<AttackButton>();
  private frame = 0;
  private listeners: InputCallback[] = [];
  private directionKeys = { up: false, down: false, left: false, right: false };
  // Track when each button was first pressed (frame number)
  private buttonPressFrame = new Map<AttackButton, number>();

  constructor() {
    this.bindings = this.loadBindings();
    this.setupListeners();
  }

  private loadBindings(): KeyBindings {
    try {
      const saved = localStorage.getItem('sf6-keybindings');
      if (saved) {
        // Merge saved bindings with defaults so new keys are always present
        return { ...DEFAULT_KEYBINDINGS, ...JSON.parse(saved) };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_KEYBINDINGS };
  }

  saveBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    localStorage.setItem('sf6-keybindings', JSON.stringify(bindings));
  }

  getBindings(): KeyBindings {
    return { ...this.bindings };
  }

  onInput(cb: InputCallback): void {
    this.listeners.push(cb);
  }

  private emit(pressed: boolean): void {
    // Compute hold durations for released buttons
    let holdDurations: Map<AttackButton, number> | undefined;
    if (!pressed) {
      holdDurations = new Map();
      for (const [btn, pressFrame] of this.buttonPressFrame) {
        holdDurations.set(btn, this.frame - pressFrame);
      }
    }
    const event: InputEvent = {
      frame: this.frame,
      direction: this.currentDirection,
      buttons: Array.from(this.currentButtons),
      pressed,
      holdDurations,
    };
    for (const cb of this.listeners) cb(event);
  }

  tick(): void {
    this.frame++;
  }

  getFrame(): number {
    return this.frame;
  }

  resetFrame(): void {
    this.frame = 0;
  }

  getCurrentDirection(): Direction {
    return this.currentDirection;
  }

  getCurrentButtons(): Set<AttackButton> {
    return new Set(this.currentButtons);
  }

  getButtonHoldDuration(btn: AttackButton): number {
    const pressFrame = this.buttonPressFrame.get(btn);
    if (pressFrame === undefined) return 0;
    return this.frame - pressFrame;
  }

  private updateDirection(): void {
    const { up, down, left, right } = this.directionKeys;
    let dir: Direction = 5;
    if (up && left) dir = 7;
    else if (up && right) dir = 9;
    else if (down && left) dir = 1;
    else if (down && right) dir = 3;
    else if (up) dir = 8;
    else if (down) dir = 2;
    else if (left) dir = 4;
    else if (right) dir = 6;
    this.currentDirection = dir;
  }

  private keyToAction(key: string): string | null {
    const k = key.toLowerCase() === key ? key : key; // preserve case for special keys
    for (const [action, bound] of Object.entries(this.bindings)) {
      if (bound === k || bound.toLowerCase() === k.toLowerCase()) return action;
    }
    return null;
  }

  private setupListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const key = e.key;
      if (this.heldKeys.has(key)) return;
      this.heldKeys.add(key);

      const action = this.keyToAction(key);
      if (!action) return;

      e.preventDefault();
      let changed = false;

      if (action === 'up') { this.directionKeys.up = true; changed = true; }
      else if (action === 'down') { this.directionKeys.down = true; changed = true; }
      else if (action === 'left') { this.directionKeys.left = true; changed = true; }
      else if (action === 'right') { this.directionKeys.right = true; changed = true; }
      else if (['LP', 'MP', 'HP', 'LK', 'MK', 'HK'].includes(action)) {
        const btn = action as AttackButton;
        this.currentButtons.add(btn);
        this.buttonPressFrame.set(btn, this.frame);
        changed = true;
      }
      // Combo macro keys: press one key to activate two buttons simultaneously
      else if (action === 'LPLK') {
        this.currentButtons.add('LP');
        this.currentButtons.add('LK');
        changed = true;
      }
      else if (action === 'MPMK') {
        this.currentButtons.add('MP');
        this.currentButtons.add('MK');
        changed = true;
      }
      else if (action === 'HPHK') {
        this.currentButtons.add('HP');
        this.currentButtons.add('HK');
        changed = true;
      }

      if (changed) {
        this.updateDirection();
        this.emit(true);
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key;
      this.heldKeys.delete(key);

      const action = this.keyToAction(key);
      if (!action) return;

      e.preventDefault();

      // Collect released buttons and their hold durations BEFORE removing them
      const releasedButtons: AttackButton[] = [];
      const holdDurations = new Map<AttackButton, number>();

      if (['LP', 'MP', 'HP', 'LK', 'MK', 'HK'].includes(action)) {
        const btn = action as AttackButton;
        const pressFrame = this.buttonPressFrame.get(btn);
        if (pressFrame !== undefined) holdDurations.set(btn, this.frame - pressFrame);
        releasedButtons.push(btn);
      }
      else if (action === 'LPLK') {
        for (const btn of ['LP', 'LK'] as AttackButton[]) {
          const pf = this.buttonPressFrame.get(btn);
          if (pf !== undefined) holdDurations.set(btn, this.frame - pf);
          releasedButtons.push(btn);
        }
      }
      else if (action === 'MPMK') {
        for (const btn of ['MP', 'MK'] as AttackButton[]) {
          const pf = this.buttonPressFrame.get(btn);
          if (pf !== undefined) holdDurations.set(btn, this.frame - pf);
          releasedButtons.push(btn);
        }
      }
      else if (action === 'HPHK') {
        for (const btn of ['HP', 'HK'] as AttackButton[]) {
          const pf = this.buttonPressFrame.get(btn);
          if (pf !== undefined) holdDurations.set(btn, this.frame - pf);
          releasedButtons.push(btn);
        }
      }

      // Emit release event with released buttons and hold durations
      if (releasedButtons.length > 0) {
        const event: InputEvent = {
          frame: this.frame,
          direction: this.currentDirection,
          buttons: releasedButtons,
          pressed: false,
          holdDurations,
        };
        for (const cb of this.listeners) cb(event);
      }

      // Now actually remove the buttons
      for (const btn of releasedButtons) {
        this.currentButtons.delete(btn);
        this.buttonPressFrame.delete(btn);
      }

      // Handle direction keys
      if (action === 'up') this.directionKeys.up = false;
      else if (action === 'down') this.directionKeys.down = false;
      else if (action === 'left') this.directionKeys.left = false;
      else if (action === 'right') this.directionKeys.right = false;

      this.updateDirection();

      // Emit direction update if only direction changed
      if (releasedButtons.length === 0 && ['up', 'down', 'left', 'right'].includes(action)) {
        const event: InputEvent = {
          frame: this.frame,
          direction: this.currentDirection,
          buttons: [],
          pressed: false,
        };
        for (const cb of this.listeners) cb(event);
      }
    });

    // Reset on focus loss
    window.addEventListener('blur', () => {
      this.heldKeys.clear();
      this.currentButtons.clear();
      this.directionKeys = { up: false, down: false, left: false, right: false };
      this.currentDirection = 5;
    });
  }
}
