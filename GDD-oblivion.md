

# Game Design Document: Horn of Oblivion

**Target Platform:** Web (HTML5/JavaScript)
**Target Constraint:** JS13kB Competition (< 13kB zipped)
**Genre:** Physics Chain-Reaction / Destruction Arcade

---

## 1. Executive Summary & Core Concept

### 1.1 High Concept
*Horn of Oblivion* is a high-octane physics destruction game that combines the satisfying chain reactions of *Peggle* with the structural collapse mechanics of *Angry Birds*.

### 1.2 The Absurd Concept
You operate a divine, rainbow-charged unicorn horn railgun. Your objective is the total annihilation of complex, fragile cities populated by corrupt greyscale bureaucrats. These cities are architectural representations of red tape. By launching your unicorn head-first into structural weak points, you trigger catastrophic, escalating light-refraction explosions that pulverize the bureaucracy.

### 1.3 13kB Optimization Vision
The game’s aesthetic and mechanics are designed to be "math-heavy, asset-light." The visual "juice"—the explosions and particle chaos—is generated purely via code (Canvas blending modes and math) rather than pre-rendered sprite assets, allowing the entire experience to fit under the strict constraint while maximizing visual flair.

## 1.4 Art style
The game is completely rendered procedural using a cel-shaded, stylized and hand-drawn art style with ultra-hd vfx and animations like for walk/run cycles.
All animations need to be hyper realistic, use web references to get them right, check carefully with chrome mcp to detect inconsistencies.
---

## 2. Aesthetics & Tone

### 2.1 Visual Style (The Contrast)
The game relies heavily on visual contrast to drive the humor and narrative.
*   **The World (Greyscale):** Cities, buildings, and the "bureaucrat" enemies are rendered entirely in monotone, red-tape-like shades of grey. They are angular, fragile, and rigid.
*   **The Power (Spectrum):** The Unicorn, the Railgun, and the resulting destruction are rendered in hyper-saturated, glowing neon rainbow colors.
*   **Effect Blending:** The game must use `ctx.globalCompositeOperation = 'lighter'`. When glowing particles overlap, they create intense white light, generating "cheap" fireworks effects.

### 2.2 Audio (Procedural Synth)
The soundtrack and SFX must be generated procedurally (e.g., using a tiny library like ZzFX) to save space.
*   **Music:** High-tempo, recursive 8-bit chip-synth.
*   **SFX:** High-frequency laser pings, glass shattering sounds, and descending pitch low-frequency explosions (all generated mathematically).

---

## 3. Core Mechanics

### 3.1 Aim & Launch (The Player Action)
This is a standard 2D aiming mechanic refined for twitch gameplay.
1.  **Input:** Drag (touch or mouse) *away* from the Railgun structure.
2.  **Visuals:** A dotted trajectory line (matching the current weapon color) appears, showing the initial path.
3.  **Power:** A meter increments based on drag distance.
4.  **Release:** Releases the projectile (the Unicorn) at high velocity on the set trajectory.

### 3.2 Light Refraction (The Multiplier)
This is the central satisfying mechanic.
1.  **The Projectile:** The Unicorn acts as a powerful prism.
2.  **The Impact:** Upon striking a hard surface (building block), the Unicorn projectile is destroyed, triggering the initial "Oblivion Event."
3.  **The Refraction Splintering:** From the impact point, $N$ (e.g., 5-10) smaller, faster, bouncing rainbow light beams are spawned.
4.  **Geometric Spawning:** The spawning angles are calculated based on the angle of incidence ($Angle_{impact} \pm 45^\circ$), ensuring the destruction "spreads" logically into the structure rather than bouncing back.
5.  **Chain Reactions:** Each subsequent beam can strike *another* block, either destroying it or triggering *further* splintering refractions (depending on current player upgrades/power).

### 3.3 Dynamic Collapse & Score

1.  **Physics:** Destruction relies on basic 2D rigid body physics (gravity, collision). Blocks have small mass values. When supporting blocks are vaporized by light beams, those above them collapse.
2.  **Bureacrats:** Small grey "bureaucrat" enemies occupy spaces inside buildings. They are eliminated when blocks collapse on them or light beams vaporize them.
3.  **High-Score Combo:** A combo counter increments for continuous destruction (e.g., `blocks destroyed` + `bureaucrats eliminated` within a 1-second window). Collapses maintain the combo.
4.  **Multiplier:** The score awarded per block increases linearly with the combo counter.

---

## 4. Technical Specifications & Math

### 4.1 Physics Module
To fit in 13kB, you must avoid complex external engines.
*   **Implementation:** Use a tiny custom implementation for 2D rigid bodies: `position`, `velocity`, `acceleration` vectors, simple circle-circle and circle-rect collision checks, and basic `AABB` (Axis-Aligned Bounding Box) sweeping for fast projectiles.
*   **Micro-Engine Alternative:** If custom code is too slow/large, use a heavily trimmed micro-physics library (e.g., Box2D-Lite JS, or equivalent `< 2kB` option).

### 4.2 Mathematical Refraction Formula
The angles of incidence ($ \theta_{in} $) must be tracked for the incoming projectile. The splinter projectiles must calculate their trajectory ($\theta_{splinter}$) based on the normal vector ($ \vec{n} $) of the impacted surface.

$$\theta_{reflected} = \theta_{in} - 2(\theta_{in} \cdot \vec{n}) \vec{n}$$

Each spawned splinter beam is given a random variation ($ \pm 10^\circ $) centered on the reflection vector.

---

## 5. User Interface (UI) and Flow

### 5.1 Game States
1.  **MAIN MENU:** Title "Horn of Oblivion," High Score display, "LAUNCH" button.
2.  **PRE-AIM:** City is displayed, showing key bureaucrat locations.
3.  **AIMING:** Drag active, dotted trajectory visible, power meter visible.
4.  **OBLIVION LOOP:** Projectile active, chain reactions cascading, combo UI active.
5.  **SCORE SUMMARY:** Destruction percentage, score, combo total, "REPLAY/NEXT CITY" buttons.

### 5.2 HUD Elements
*   **Score:** Neon text at top left.
*   **Combo:** Flashing neon text below Score (e.g., "75X COMBO!").
*   **Ammunition:** (Optional, if multiple shots allowed) Unicorn icons at bottom left.

---

## 6. Development & Optimization Strategy (13kB Rules)

### 6.1 No Sprites (Vector & Canvas)
*   Everything must be drawn using Canvas 2D methods: `beginPath()`, `moveTo()`, `lineTo()`, `arc()`, `fill()`, and `stroke()`.
*   Blocks are simple `rects`. Beams are `lines`. The Unicorn itself can be represented by a few overlapping triangles and arcs (similar to Frame 1 of the storyboard).

### 6.2 Build Pipeline
This is non-negotiable for 13kB competition.
1.  **Minification:** Use UglifyJS or Terser.
2.  **Bundling:** Webpack or Rollup to eliminate dead code.
3.  **Advanced Compression:** Use **Roadroller** (an innovative JS packer specifically for J13k) after standard minification.
4.  **Final Zip:** Use `advzip` (part of AdvanceCOMP) for maximum ZIP compression.

### 6.3 Code Architecture
*   **Global Objects:** Define `gameState`, `player`, `projectiles[]`, `blocks[]`, and `bureaucrats[]` globally for efficient access.
*   **Pooled Particles:** Implement a particle pooling system (e.g., pre-allocate 1000 particle objects and reuse them) to maximize performance when thousands of glowing beams are active, rather than creating/destroying objects constantly.