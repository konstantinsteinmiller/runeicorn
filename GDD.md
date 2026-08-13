# GAME DESIGN DOCUMENT (GDD)

# 1. Game Overview

## 1.1 Project Title
**Plague of Light: Rainbow Swarm**

## 1.2 Target Platform
Web Browser (Desktop & Mobile, highly performance-optimized).

## 1.3 Genre
Reverse Tower Defense / Micro-RTS / Swarm Simulator.

## 1.4 Hard Constraints
The entire game, compressed into a single `.zip` file, must not exceed 13 kilobytes. This document must respect this limit.

## 1.5 Concept Summary
You command a horrifyingly efficient, recursive swarm of cloning mini-unicorns spreading a blinding "Glitter Infection" across a grim, grey, 2D fantasy empire. The player does not control units directly; they control their path. You click and drag to draw dynamic "Rainbow Conveyor Trails" across the landscape. The horde automatically follows these trails, multiplying exponentially as they annihilate enemy formations and convert grey castles into glowing neon rainbow hives.

## 1.6 Core Gameplay Loop
1.  **DRAW:** Player clicks and drags to create a dynamic, segmented Rainbow Conveyor Trail.
2.  **SPAWN:** The Main Hive (the first Hive) starts producing mini-unicorns that automatically follow the new trail.
3.  **MULTIPLY & ATTACK:** The swarm grows as it travels. Units clash with grey enemies. Killing enemies yields "Glitter Dust."
4.  **RE-CONVERT:** A critical number of mini-unicorns reaching an enemy Castle convert it into a new Rainbow Hive, which begins spawning more units.
5.  **REACT:** Enemy mages generate dark "Void Wounds" that cut trails and halt the swarm.
6.  **OVERLOAD:** The player must either redraw a new trail or expend accumulated "Glitter Dust" to generate a "Overload Glitter Wave" to force passage through the Void Wound.

## 1.7 Unique Selling Point (USP)
*   **The Absurd Twist:** Horrifying unicorns and blinding glitter used as a weapon against a standard "serious" fantasy setting.
*   **Unique Control:** Directing a *flow*, not individual units, via path drawing.
*   **Extreme Scale:** A massive, dynamic swarm visualized with high-intensity vector art and particle effects.

## 1.8 Art style
The game is completely rendered procedural using a cel-shaded, stylized and hand-drawn art style with ultra-hd vfx and animations like for walk/run cycles.
All animations need to be hyper realistic, use web references to get them right, check carefully with chrome mcp to detect inconsistencies.
---

# 2. Mechanics: The Swarm

The game simulation revolves entirely around the interaction between the player's trails, the autonomous behavior of the swarm, and the environment.

## 2.1 The Rainbow Swarm (Unit AI)
The swarm is not composed of complex individuals. Each mini-unicorn unit uses a simplified **Boids Flocking Algorithm** to achieve cohesive swarm behavior without taxing the CPU.

### Unit Properties
*   **Size:** Very small (e.g., a simple 4-pixel triangle with a tail).
*   **Speed:** Fast (scales slightly as the swarm grows).
*   **Attack:** Deals contact damage to grey enemies and structures.
*   **Reproduction (Recursive Cloning):** While following a *healthy* trail, units have a fixed, slow probability (e.g., 0.1% per frame) of spawning a clone of themselves. This drives exponential growth. This probability stops if the trail is broken.

### Unit Behavior Tree (The Core Logic)
Each unit checks, in priority order:
1.  **Collision (Combat):** Is an enemy touching me? Attack.
2.  **Pathing (Primary Objective):** Am I near a valid (unbroken) segment of the Rainbow Trail? If yes, apply force toward the path *direction*.
3.  **Flocking (Cohesion/Separation):** Apply Boids rules (Alignment, Cohesion, Separation) relative to *only* its nearest 5-8 neighbors.
4.  **Goal (Conversion):** Am I within 10 pixels of an un-converted Castle? If yes, crash into it (die) and contribute conversion damage.

## 2.2 Rainbow Conveyor Trails (Player Input)
Trails are the only way to guide the horde.

### Input Mechanic
*   **Draw:** `mousedown` + `mousemove`. The path must start from an existing Rainbow Hive (see 3.1) or the intersection of an active trail. A trail cannot be drawn through a Void Wound (see 3.3).
*   **Segmented Path:** Each mousemovement creates a new *point* in a `pathArray`. Points are connected by a `pathLine`.
*   **Max Length:** The total accumulated length of all trails is capped by a player resource (e.g., "Prismatic Capacity"). This resource regenerates when a Hive is converted.
*   **Trail Strength:** The thickness and color intensity of the trail are determined by the number of unicorns *currently using* that segment. A heavily traveled trail is thick and bright.

---

# 3. Game World and Enemies

## 3.1 The Main Hive (Player Start)
*   The only source of initial power. Visually, a small spiral crystalline tower pulsing with neon light.
*   Automatically produces 2 mini-unicorns per second.
*   Connects to the first Rainbow Trail drawn by the player.

## 3.2 Castle Structures (Conversion Targets)
Castles are stationary enemy spawn points. They are the objective.

*   **Grey Castle (State 1):** Appears as a dull, monochromatic grey structure (sketch style). Slowly produces `Grey Soldiers` (3.3).
*   **Conversion (Transition State):** Occurs when mini-unicorns crash into the Castle. The castle gains a colorful "conversion meter" that fills up. When full, a `Conversion Explosion` (blinding light particle effect) occurs.
*   **Rainbow Neon Hive (State 2):** After conversion, the castle is permanently transformed into a glowing neon hive. It looks like the Main Hive but slightly smaller. It now:
    *   Ceases spawning `Grey Soldiers`.
    *   Starts spawning 1 `mini-unicorn` per second.
    *   Actively contributes to player score.
    *   Adds to the total `Prismatic Capacity`.

## 3.3 The Enemy: The Grim Empire
Enemies spawn primarily from Grey Castles or are preset on the map.

*   **Grey Soldiers:** Slow-moving, monochromatic melee units. They move in simple phalanx formations (fixed path AI). They attempt to engage the swarm head-on to slow it down.
*   **Void Mages (The Counter):** Crucial enemies. They do not attack the swarm directly. They target the *mid-point* of long, active Rainbow Trails.
    *   **Spell: Void Wound.** The mage casts a slow-moving, dark projectile that, on impact, generates a temporary, 50-pixel diameter circle of "Void Wound."
*   **Void Wound (Environment Effect):**
    *   **Logic:** The `Void Wound` logic (a simple boolean check) cuts all path connections *inside* its radius. The segments of the Rainbow Trail within the circle immediately turn dull and broken.
    *   **Effect on Swarm:** Units currently *on* that broken segment immediately lose `Pathing` force (they stop). They default to simple `Boids` drift or attack nearby targets. The swarm *after* the cut receives zero new units.
    *   **Visual:** The affected segments are covered in static-like, black-and-grey artifacts, contrasting with the vibrant rest of the trail.

---

# 4. Systems and Constraints (13kB Strategy)

This section details how the game achieves its vision while hitting the byte limit. The strategy is to prioritize procedurally generated math over stored assets.

## 4.1 Asset Budget (Approximate)
*   **Logic Code (JS):** 6-7kB
*   **Graphics (Vector Data/Render Logic):** 2-3kB
*   **Audio (Synth Logic):** 1-2kB
*   **HTML/CSS:** <1kB

## 4.2 Rendering Strategy (Procedural)
No raster images (.png, .jpg) are permitted. All visuals are procedural, rendered using Canvas 2D.

*   **Monochromatic Background:** A simple `canvas.fillRect()` for the grey background texture. Structures (castles) are simple vector paths (`moveTo`, `lineTo`) stored as coordinates.
*   **Unit Vector Art:** Mini-unicorns are represented by simple, three-point geometric triangles with a trailing `ctx.shadowBlur` effect to simulate a light source and tail.
*   **The Rainbow Effect:**
    *   Trails are drawn with `ctx.lineWidth` (dynamic) and a variable rainbow color (`hsla(v, 100%, 50%, a)` where `v` increments per path pixel).
    *   A critical optimization trick: Draw the trail *once* with full rainbow saturation, then overlay a high-transparency `source-atop` filter `canvas.globalCompositeOperation = 'lighten';` for the entire world to make the converted areas glow.

## 4.3 High-Intensity Particle Systems (Juice)
Within 13kB, "Juice" must be simulated with very little code.

*   **Particle Emitter Logic:** A single, lightweight `Particle` class (`x,y,vx,vy,life,color`).
*   **Implementation:** All explosions (Enemy Death, Conversion Explosion, Glitter Wave Overload) are generated by *instantly* spawning 50-100 `Particle` objects. They have high velocity, dynamic drag, and decay in opacity. The total particle count in memory is capped (e.g., 500 total active particles) to prevent memory crashes.

## 4.4 Audio (Synthetic)
No stored audio files. Sounds are synthesized using the **Web Audio API** at runtime, based on simple math functions (`Math.sin`, noise).

*   **Synth Sound Palettes:**
    *   **Swarm hum:** A continuous, pitch-modulated sine-wave oscillator, increasing in pitch and amplitude as the swarm count grows.
    *   **Lasers/Hits:** A fast, high-frequency square-wave oscillator sweep (`osc.frequency.setValueAtTime()`) on unit death.
    *   **Void Void Cut:** A low, rumbling filtered noise burst (`BufferSource` with randomized noise and a low-pass filter sweep).
    *   **Conversion:** A satisfying, ascending synth chord progression.

---

# 5. UI and Control (The Interface)

The UI is minimal to minimize assets.

*   **Control Mechanism (Desktop):** Click-and-drag trail drawing. Hovering over a trail reveals its total length against the current `Prismatic Capacity`.
*   **Heads-Up Display (Overlay):**
    *   **Unicorn Count:** Total active units.
    *   **Prismatic Capacity:** Current/Max (shown as a color gradient bar).
    *   **Castles Converted:** Simple fraction X/Y.
*   **Glitter Overload (Input: `SPACEBAR` or Mobile Tap-Area):**
    *   When pressed, it consumes a large portion of Glitter Dust to trigger a full-screen, radial **Glitter Shockwave** that instantly purges any `Void Wounds` on the map and makes the entire swarm invincible for 3 seconds. The effect must be mechanically deep but visually *insane*, achieved with thousands of tiny particles and intense `ctx.shadowBlur`.