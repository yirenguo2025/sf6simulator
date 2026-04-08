import { MoveData, ComboHit, ComboState, ComboConnectionType } from '../types';

// SF6 Damage Scaling Rules
// Hit 1: 100%, Hit 2: 100%, Hit 3: 80%, Hit 4: 70%, Hit 5: 60%, Hit 6+: decreasing by 10% (min 10%)
function getHitScaling(hitNumber: number): number {
  if (hitNumber <= 2) return 1.0;
  if (hitNumber === 3) return 0.8;
  if (hitNumber === 4) return 0.7;
  if (hitNumber === 5) return 0.6;
  if (hitNumber === 6) return 0.5;
  if (hitNumber === 7) return 0.4;
  if (hitNumber === 8) return 0.3;
  if (hitNumber === 9) return 0.2;
  return 0.1; // minimum 10%
}

// Parse the dmgScaling string to extract modifiers
interface ScalingModifiers {
  starterPercent: number;    // percentage subtracted if this is the combo starter (e.g., 20 for "20% Starter")
  immediatePercent: number;  // percentage subtracted always (e.g., 20 for "20% Immediate")
  minimumPercent: number;    // minimum scaling floor (e.g., 50 for "50% Minimum")
  multiplierPercent: number; // multiplier applied to subsequent combo damage (e.g., 15 for "15% Multiplier")
}

function parseScaling(dmgScaling: string): ScalingModifiers {
  const mods: ScalingModifiers = {
    starterPercent: 0,
    immediatePercent: 0,
    minimumPercent: 0,
    multiplierPercent: 0,
  };

  if (!dmgScaling) return mods;

  // Match "X% Starter"
  const starterMatch = dmgScaling.match(/(\d+)%\s*Starter/i);
  if (starterMatch) mods.starterPercent = parseInt(starterMatch[1]);

  // Match "X% Immediate"
  const immediateMatch = dmgScaling.match(/(\d+)%\s*Immediate/i);
  if (immediateMatch) mods.immediatePercent = parseInt(immediateMatch[1]);

  // Match "X% Minimum"
  const minimumMatch = dmgScaling.match(/(\d+)%\s*Minimum/i);
  if (minimumMatch) mods.minimumPercent = parseInt(minimumMatch[1]);

  // Match "X% Multiplier"
  const multiplierMatch = dmgScaling.match(/(\d+)%\s*Multiplier/i);
  if (multiplierMatch) mods.multiplierPercent = parseInt(multiplierMatch[1]);

  return mods;
}

export class DamageCalculator {
  // Calculate damage for a full combo
  calculateCombo(moves: { move: MoveData; connectionType: ComboConnectionType | null; isDriveRush: boolean }[]): ComboState {
    const hits: ComboHit[] = [];
    let totalDamage = 0;
    let hitCount = 0;
    let driveGaugeUsed = 0;
    let currentScaling = 1.0;
    let drMultiplierApplied = false;

    for (let i = 0; i < moves.length; i++) {
      const { move, connectionType, isDriveRush } = moves[i];
      hitCount++;

      // Base hit scaling from combo position
      const hitScale = getHitScaling(hitCount);

      // Parse move-specific scaling
      const scalingMods = parseScaling(move.dmgScaling);

      // Calculate effective scaling for this hit
      let effectiveScaling = hitScale;

      // Apply starter scaling (only on first hit)
      if (hitCount === 1 && scalingMods.starterPercent > 0) {
        effectiveScaling *= (1 - scalingMods.starterPercent / 100);
      }

      // Apply immediate scaling (always)
      if (scalingMods.immediatePercent > 0) {
        effectiveScaling *= (1 - scalingMods.immediatePercent / 100);
      }

      // Apply Drive Rush multiplier (15% reduction for the combo after DR)
      if (isDriveRush && !drMultiplierApplied) {
        effectiveScaling *= 0.85;
        drMultiplierApplied = true;
      }

      // Apply DR mid-combo multiplier
      if (scalingMods.multiplierPercent > 0) {
        effectiveScaling *= (1 - scalingMods.multiplierPercent / 100);
      }

      // Minimum scaling floor (mainly for Supers)
      if (scalingMods.minimumPercent > 0) {
        const minScale = scalingMods.minimumPercent / 100;
        effectiveScaling = Math.max(effectiveScaling, minScale);
      }

      // Calculate actual damage
      const rawDamage = move.damage;
      const scaledDamage = Math.floor(rawDamage * effectiveScaling);

      totalDamage += scaledDamage;
      currentScaling = effectiveScaling;

      // Track drive gauge
      if (move.driveGain < 0) {
        driveGaugeUsed += Math.abs(move.driveGain);
      }
      if (isDriveRush && connectionType === 'dr_cancel') {
        driveGaugeUsed += 30000; // 3 bars for DR cancel
      }

      hits.push({
        move,
        hitNumber: hitCount,
        connectionType,
        rawDamage,
        scaledDamage,
        scalingPercent: Math.round(effectiveScaling * 100),
        frameInCombo: 0, // will be set by combo engine
        isDriveRush,
      });
    }

    return {
      hits,
      totalDamage,
      hitCount,
      isValid: true,
      driveGaugeUsed,
      superGaugeUsed: 0,
      currentScaling,
      endReason: 'active' as const,
    };
  }

  // Quick single-hit damage calculation
  calculateSingleHit(move: MoveData): number {
    return move.damage;
  }
}
