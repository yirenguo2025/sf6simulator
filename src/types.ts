// ===== Game Button Types =====
export type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
// Numpad notation: 5=neutral, 6=forward, 4=back, 8=up, 2=down
// 7=up-back, 9=up-forward, 1=down-back, 3=down-forward

export type AttackButton = 'LP' | 'MP' | 'HP' | 'LK' | 'MK' | 'HK';

export const DIRECTION_SYMBOLS: Record<Direction, string> = {
  1: '↙', 2: '↓', 3: '↘',
  4: '←', 5: '●', 6: '→',
  7: '↖', 8: '↑', 9: '↗',
};

export const BUTTON_COLORS: Record<AttackButton, string> = {
  LP: '#5b9bd5', MP: '#ffc000', HP: '#00b050',
  LK: '#5b9bd5', MK: '#ffc000', HK: '#00b050',
};

// ===== Input Event =====
export interface InputEvent {
  frame: number;
  direction: Direction;
  buttons: AttackButton[];
  pressed: boolean; // true=keydown, false=keyup
  holdDurations?: Map<AttackButton, number>; // on release: how long each button was held
}

// ===== Frame Data for a Move =====
export interface MoveData {
  id: string;             // unique key, e.g. "5LP", "236HP"
  input: string;          // display input notation
  name?: string;          // move name
  damage: number;         // raw damage
  startup: number;        // startup frames (first active frame)
  active: string;         // active frames (e.g. "3" or "2,5")
  recovery: number;       // recovery frames
  total: number;          // total frames
  hitAdv: string;         // on-hit advantage
  blockAdv: string;       // on-block advantage
  guard: string;          // guard type: L, H, LH, T
  cancel: string;         // cancel properties: Chn, Sp, SA, PS, TC, -
  hitconfirm: string;     // hitconfirm window
  // Extended data
  hitstun: number;        // hitstun frames on opponent
  blockstun: number;      // blockstun frames on opponent
  hitstop: number;        // hitstop frames
  dmgScaling: string;     // scaling info, e.g. "20% Starter"
  drCancelOnHit: string;
  drCancelOnBlock: string;
  afterDrOnHit: string;
  afterDrOnBlock: string;
  punishAdv: string;
  perfParryAdv: string;
  // Drive/Super gauge
  driveDmgBlock: number;
  driveDmgHit: number;
  driveGain: number;
  superGainHit: string;
  superGainBlock: string;
  // Juggle
  juggleStart: string;
  juggleIncrease: string;
  juggleLimit: string;
  // Properties
  invuln: string;
  armor: string;
  airborne: string;
  range: string;
  notes: string;

  category: MoveCategory;
}

export type MoveCategory =
  | 'normal'
  | 'command'
  | 'target_combo'
  | 'throw'
  | 'drive'
  | 'special'
  | 'prowler'
  | 'super';

// ===== Combo System =====
export type ComboConnectionType = 'link' | 'cancel' | 'chain' | 'target_combo' | 'dr_cancel' | 'juggle';

export interface ComboHit {
  move: MoveData;
  hitNumber: number;       // which hit in the combo (1-based)
  connectionType: ComboConnectionType | null; // how connected from previous
  rawDamage: number;
  scaledDamage: number;
  scalingPercent: number;  // current scaling multiplier
  frameInCombo: number;    // frame when this move started
  isDriveRush: boolean;    // was this after a drive rush?
}

export type ComboEndReason = 'active' | 'completed' | 'dropped';

export interface ComboState {
  hits: ComboHit[];
  totalDamage: number;
  hitCount: number;
  isValid: boolean;        // is the combo actually connecting?
  driveGaugeUsed: number;
  superGaugeUsed: number;
  currentScaling: number;  // current damage scaling multiplier (0-1)
  endReason: ComboEndReason;
  dropInfo?: string;       // info about the drop (e.g. which move, frame disadvantage)
  completionInfo?: string; // info about combo completion
}

// ===== Character State (for frame simulation) =====
export type CharacterPhase =
  | 'idle'
  | 'startup'
  | 'active'
  | 'recovery'
  | 'hitstun'
  | 'blockstun'
  | 'knockdown';

export interface CharacterState {
  phase: CharacterPhase;
  currentMove: MoveData | null;
  frameInPhase: number;     // how many frames into current phase
  totalPhaseFrames: number; // total frames for current phase
  canCancel: boolean;       // is in cancel window?
  canLink: boolean;         // can link into next move?
  isDriveRushing: boolean;
  driveGauge: number;       // 0-60000 (6 bars * 10000)
  superGauge: number;       // 0-10000 (SA1=1bar, SA2=2bar, SA3=3bar)
}

// ===== Motion Command Definitions =====
export interface MotionCommand {
  id: string;           // "236P", "623K", etc.
  directions: number[]; // required direction sequence
  button: string;       // "P", "K", "PP", "KK" or specific button
  priority: number;     // higher = checked first (prevents 236 eating 623)
}

// ===== Key Binding =====
export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  LP: string;
  MP: string;
  HP: string;
  LK: string;
  MK: string;
  HK: string;
  LPLK: string;  // Throw (LP+LK)
  MPMK: string;  // Drive Parry (MP+MK)
  HPHK: string;  // Drive Impact (HP+HK)
}

export const DEFAULT_KEYBINDINGS: KeyBindings = {
  up:    'ArrowUp',
  down:  'ArrowDown',
  left:  'ArrowLeft',
  right: 'ArrowRight',
  LP:    'u',
  MP:    'i',
  HP:    'o',
  LK:    'j',
  MK:    'k',
  HK:    'l',
  LPLK:  'n',
  MPMK:  'm',
  HPHK:  ',',
};

// ===== Character Data =====
export interface CharacterData {
  name: string;
  hp: number;
  throwRange: number;
  fwdWalkSpeed: number;
  backWalkSpeed: number;
  fwdDashFrames: number;
  backDashFrames: number;
  moves: MoveData[];
}
