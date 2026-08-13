# GAME DESIGN DOCUMENT (GDD)

# 1. Game Overview

## 1.1 Project Title
**Prism Wave Surfer**

## 1.2 Target Platform
Web Browser (Desktop & Mobile, hyper-optimized for performance).

## 1.3 Genre
High-Speed Arcade Wave Rider / Rhythm-Runner Hybrid.

## 1.4 Visual Inspiration
*Tiny Wings* (Physics and terrain), *Bit.Trip Runner* (Aesthetic, rhythm, high intensity), *Rez* (Synesthetic feedback).

## 1.5 The Absurd Twist
You play as an apocalyptic unicorn, the last vector entity in a destroyed dark dimension. You surf atop a massive, pulsing, math-generated sine-wave rainbow, using sonic rainbow booms to vaporize incoming monochromatic space demons.

## 1.6 Core Gameplay Loop
1.  **SURF:** The Unicorn automatically moves rightward.
2.  **HOLD (Gravity):** Player holds input to increase the Unicorn’s weight.
3.  **DIVE:** Time the **Hold** state to dive into the valley of the procedural rainbow sine-wave to gain maximum velocity.
4.  **RELEASE (Momentum):** Player releases input at the valley floor.
5.  **LAUNCH:** Momentum up the crest propels the Unicorn into the air.
6.  **CHARGE & ATTACK:** Launching builds "Prism Power." Landing with sufficient impact triggers a **Rainbow Sonic Shockwave**, clearing enemies and obstacles.

## 1.7 13kB Constraint Strategy
Everything is procedurally generated.
*   Terrain: Pure `Math.sin` superposition.
*   Visuals: Single Canvas 2D/micro-WebGL, vector lines, intense particle systems.
*   Audio: Web Audio API synthesis.
*   Physics: Analytical momentum math (no complex engine).

## 1.8 Art style
The game is completely rendered procedural using a cel-shaded, stylized and hand-drawn art style with ultra-hd vfx and animations like for walk/run cycles.
All animations need to be hyper realistic, use web references to get them right, check carefully with chrome mcp to detect inconsistencies.
---


## 2. Mechanics: The Surfing System

The physics loop is designed for high-octane "flow state."

## 2.1 Inputs (Binary Control)
The game uses a single input (mousedown/tap).
*   **State A: Released (Default):** Normal Gravity applied.
*   **State B: Hold:** Extreme Gravity applied. High friction if touching the wave. Dynamic Magenta glow added to the Unicorn vector.

## 2.2 Wave Surfing (Analytical Momentum)
The simulation translates the vector position along a 1D terrain function.

### A. Terrain Function (`Math.sin`)
The rainbow wave ($T$) is generated at runtime by summing multiple sine waves with different frequencies and amplitudes:
$$T(x) = (\sin(x \cdot f_1) \cdot a_1) + (\sin(x \cdot f_2) \cdot a_2) + (\sin(x \cdot f_3) \cdot a_3)$$
Where:
*   $f_1$ (Base terrain frequency) is low, $a_1$ (Base terrain amplitude) is high.
*   $f_2, f_3$ are higher frequencies (adding noise/rolling hills).
*   $a_2, a_3$ decrease, ensuring base shape dominance.
*   The wave is offset vertically based on game difficulty.

### B. Analytical Physics
Instead of collision detection, we map the Unicorn's $x$ directly to the terrain height.
1.  **Determine Slope:** Calculate the slope ($\text{dy/dx}$) of the wave function at the current position $x$.
2.  **State-Dependent Velocity:**
    *   **In Hold State:** Downward velocity ($V_y$) is maximized. Forward velocity ($V_x$) is slowed slightly by friction. The goal is to dive *against* the slope into the valley.
    *   **In Released State:** The analytical gravity transforms $V_y$ into $V_x$. If moving *up* a slope, Released state converts $V_x$ back to $V_y$, maximizing launch height.

## 2.3 Launching & Prism Power (Score)
Launching off the crest of a wave is the primary scoring mechanic.

*   **Launch Detection:** When velocity is directed up, and the analytical height exceeds the crest height by 5 pixels, the Unicorn enters `Airborne` state.
*   **Prism Power Generation:** While airborne, `Prism Power` points are awarded exponentially based on:
    *   Launch Velocity.
    *   Time Airborne.
    *   A continuous cyan trail render is drawn.

---

## 3. Systems: Feedback Loop (Juice)

In 13kB, feedback (Juice) is simulated with intense particle bursts and procedural shaders.

## 3.1 Rainbow Sonic Shockwave (Attack)
The primary mechanic for destroying enemies.

*   **Trigger:** Landing back on the wave *after* an airborne state with sufficient vertical velocity ($V_y > 50$).
*   **Mechanic:** Generates an immediate, screen-clearing **Rainbow Sonic Shockwave**.
*   **Visual Implementation:**
    *   Instantly spawn 200 particle vectors.
    *   Particles start at impact point ($x, y$), with extreme radial velocity.
    *   Apply color shift: Start white, decay through the spectrum (`hsl(v, 100%, 50%)`), and decrease opacity until removal (`life < 0`).
    *   Screen Shake (`ctx.translate` randomize) is applied for 10 frames.

## 3.2 Dynamic Visual Aesthetics (Neon Noir)
The visual budget is managed using primitive vector shapes (`lineTo`, `moveTo`) enhanced with canvas shadow effects.

*   **Shadow Bloom:** Global `ctx.shadowBlur = 15` and `ctx.shadowColor = 'neonColor'`.
*   **Aesthetic Shift:**
    *   **Hold State (Diving):** The Unicorn, its trail, and the wave itself shift their `shadowColor` toward **Magenta**.
    *   **Released State (Flow):** Visuals shift toward **Cyan/Teal**.
    *   **Shockwave State (Apocalyptic):** All visuals become **White/Gold** for 5 frames before rainbow decay.

## 3.3 Audio Synthesis (Web Audio API)
No audio files are used. All sounds are procedurally synthesized using `OscillatorNode`.

*   **The Surfing Hum:** A Continuous triangle wave oscillator. The frequency is mapped to total velocity.
*   **Dive Rumble:** A Low-frequency square wave, only active in **Hold** state. Filter applied to simulate resistance.
*   **Shockwave Boom:** A rapid high-frequency sawtooth wave sweep from 880Hz to 110Hz, with extreme exponential decay.

---

## 4. UI and Control (Interface)

UI is minimal to maximize 13kB code economy.

## 4.1 HUD (Overlay)
The HUD is an optimized overlay (using `ctx.fillText` with system fonts).

*   **Score:** Current `Prismatic Power` points.
*   **Combo Meter:** Increases when triggering multiple shockwaves in a row without breaking flow.

## 4.2 Camera Tracking (Procedural Speed)
The camera tracking must convey extreme speed without jarring the player.

*   **Analytical Camera:** The camera $X$ is ahead of the Unicorn $X$ by dynamic distance (`UnicornX + VelocityX * constant`).
*   **Dynamic Zoom:** The camera $Z$ (scale) is adjusted inversely proportional to velocity ($1/\text{VelocityX}$). High speed = zoomed out.
*   **Lookahead:** Camera is centered on the forward-propagating terrain, ensuring the player can see upcoming valleys.