# SF6 Combo Simulator - Project Memory

## Project Overview
Street Fighter 6 combo simulator with two modes: Input Mode (real-time keyboard input) and **Builder Mode** (drag-and-drop combo builder). Built with Vite + TypeScript.

## Repository
- GitHub: https://github.com/yirenguo2025/sf6simulator
- GitHub Pages: https://yirenguo2025.github.io/sf6simulator/
- `gh` CLI installed at `/tmp/gh_extracted/gh_2.89.0_macOS_arm64/bin/gh` (may need re-download after restart)
- Deploy command: `npx vite build && npx gh-pages -d dist`

## Key Files
- `src/ui/combo-builder.ts` — Builder mode core: validate(), buildTimeline(), renderTimeline(), applyScalingAndDrive()
- `src/engine/combo-engine.ts` — ComboEngine (link/cancel/chain validation). Builder bypasses it for DR Parry, DR Cancel, backturn, super cancel.
- `src/data/alex.ts` / `src/data/terry.ts` — Character move data
- `src/style.css` — All styles including builder mode
- `index.html` — HTML structure, builder has counter toggle (OFF/CH/PC)

## Builder Mode Architecture
`validate()` is the central method. It processes the move list and produces `ChainEntry[]` with connection type, validity, scaling, and drive cost. Key special cases handled:

### Counter Hit Toggle (OFF / CH / PC)
- **Hitstun bonus**: CH +2, PC +4 on first real attack
- **Damage bonus**: CH: normals/specials +20%. PC: normals/specials +20%, normal throw +70%, command throw +15%, supers: none
- Applied in `validate()` (hitstun/hitAdv patching) and `applyScalingAndDrive()` (damage)

### Drive Rush from Parry (MPMK~66)
- Skipped in engine entirely, recorded as entry for display only
- First attack after DR gets +4 hitstun, counter bonus also stacks
- Frame bar skips the DR, starts from first attack
- Costs 1 drive bar

### Drive Rush from Cancel (66)
- Previous move must have `Sp` cancel property
- 9 frames, costs 3 drive bars
- Effective advantage after DR = prevHitAdv + prevRecovery - 9
- Next move gets +4 hitstun (DR bonus)
- All subsequent hits get ×85% scaling multiplier
- Engine reset + addMove after DR cancel move to fix engine state

### Backturn State
- Triggered by: `236HP` (always), `2PP~HP` (CH/PC only)
- Backturn follow-ups (id ends with `_BT`): always connect as cancel
- `_BT` moves without backturn state → forced DROP
- `4MK` split into: `4MK` (Oblique Stomp, normal) and `4MK_BT` (Collapsing Driver, backturn, 2000dmg, Combo 2 hits)
- Chain: `236HP → 63214PP_BT → SA2_followup` (Omega Wing Buster)

### Super Cancel Fix
- If engine says drop but previous move's cancel property allows SA (including `SA2*` with asterisk), force valid cancel
- `hasSA()` helper matches both `SA2` and `SA2*`

### Scaling System (`applyScalingAndDrive()`)
- Base: 100%, 100%, 80%, 70%, 60%, 50%, 40%, 30%, 20%, 10%
- Per-move modifiers from `dmgScaling` field:
  - `X% Starter`: hit 2 = (100-X)%
  - `X% Immediate`: this hit × (1-X/100), only when comboed into
  - `X% Immediate (Sp)`: same but only via cancel connection
  - `X% Minimum`: scaling floor (SA1=30%, SA2=40%, SA3/CA=50%)
  - `Combo (N hits)`: advances scaling counter by N
- DR Cancel: all subsequent hits ×85%

### Drive Gauge Costs
- OD moves (PP/KK, not 2PP): 2 bars
- DR from Cancel: 3 bars
- DR from Parry: 1 bar
- Drive Impact: 1 bar
- Drive Reversal: 2 bars

### Frame Bar (renderTimeline)
- Dual bar: P1 (attacker) and P2 (defender/hitstun)
- P1: green(startup-1) + red(active) + blue(recovery). Cancel truncates recovery.
- P2: yellow(hitstun) starting at hit frame. No hitstop.
- SF6 convention: startup N means Nth frame hits, so green bar = N-1 frames
- HiDPI canvas support via devicePixelRatio
- Header: "発生 Xf / 総計 Xf / 硬直差 ±Xf" (last move's data)
- hitAdv = hitstun - (active + recovery)

## Known TODO / Issues
- Terry character data may need similar special-case handling
- Scaling/drive display needs verification against actual game values
- Some edge cases in engine state after multiple DR cancels
