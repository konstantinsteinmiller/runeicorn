# Rune-icorn Duel: Game Design Document

**Version:** 1.0
**Genre:** Arcade Duel, Strategy, Gesture-based Action
**Aesthetic:** Cel-shaded, Hand-drawn, Chibi-style Humanoid Unicorns
**Target Platform:** Mobile (Touch), Web/Desktop (Mouse)

## 1. Executive Summary

### 1.1 High Concept
Rune-icorn Duel is a fast-paced magical showdown where cute, chibi-style humanoid unicorns clash using a unique gesture-based spellcasting system. Players and a dark-themed NPC must draw primitive runes to prepare powerful combined spells, balanced between offense and defense, with the very atmosphere reflecting the tide of battle.

### 1.2 Core Gameplay Loop
1.  **Draw:** The player uses a finger (mobile) or mouse (desktop) to draw primitive rune shapes on the screen.
2.  **Detect:** The game detects the shape (Triangle, Wave, Star, Quad) and adds the corresponding rune to the player's stored queue. Rough shapes are accepted.
3.  **Prepare:** The player can store up to 3 runes.
4.  **Observe:** The player observes the NPC's forming runes and stored runes (visible above their head).
5.  **Combine & Cast:** The player triggers the cast action (labeled "[Space] to cast") using Space, Enter, E, or by clicking the onscreen button. All stored runes are combined and cast as a single spell.
6.  **Resolve:** Spells resolve, applying damage or effects. HP bars update. The background atmosphere shifts based on health.
7.  **Loop:** The battle continues until one unicorn's HP reaches zero.

### 1.3 Design Pillars
*   **Intuitive Magic:** Spellcasting is a direct, gestural action that feels magical and satisfying.
*   **Accessible Strategy:** The combining rune system provides depth without overly complex rules, encouraging experimentation.
*   **Tactical Pacing:** Players must make quick decisions based on drawing accuracy, combination selection, and the NPC's actions.
*   **Clear Visual Feedback:** Every action, from drawing a rune to winning or losing, is communicated through distinct, cel-shaded visual effects and atmospheric changes.

### 1.4 Art style
The game is completely rendered procedural using a cel-shaded, stylized and hand-drawn art style with ultra-hd vfx and animations like for walk/run cycles.
All animations need to be hyper realistic, use web references to get them right, check carefully with chrome mcp to detect inconsistencies.

---

## 2. Aesthetics and Tone

### 2.1 Character Design

| Character | Style | Primary Colors | Description | Magic Casting |
| :--- | :--- | :--- | :--- | :--- |
| **Player (Aurora)** | Cute, Traditionally Shiny | White, Gold, Pastel Highlights | Majestic and graceful. The quintessential heroic unicorn, but also very cute. | Horn glows golden/white and forms the rune. |
| **NPC (Umbra)** | Cute, Dark-themed | Matte Black, Purple, Neon Cyan | Small, slightly stocky, large head. A sleepy yet menacing expression. | Horn glows dark purple/cyan and forms the rune. |

### 2.2 Visual Style & Spells
The game uses a **Hand-drawn, cel-shaded vector** style. Manners must be minimalistic yet extremely satisfying to watch.
*   **Cell-Shaded VFX:** All spell effects are composed of stylized, solid-colored shapes with thick black outlines, emphasizing impact and clarity.
*   **Rune Feedback:** Successful drawing leaves a trailing particle effect in the rune's element color. A "snapped" version of the clean rune flashes briefly before it's stored.

### 2.3 Atmospheric Progression (The Background)
The background represents the magical balance of power.

| Battle State | Background Visuals | Music/Audio |
| :--- | :--- | :--- |
| **Active Duel** | Heavy, dark grey clouds. Occasional flashes of non-damaging magic. Moody lighting. | Moody, tense synth loop. |
| **Player Winning** | Clouds thin, a faint, growing rainbow is visible. | Music gets slightly brighter. |
| **Player Victory** | A full, brilliant rainbow is fixed in the sky. Sun breaks through. | Triumphant, magical synth flourish. |
| **Player Loss** | Clouds darken to almost black. Rain begins. Moodier, low-key lighting. | Music dissolves into a melancholic low-end drone. |

---

## 3. Core Mechanics and Gestures

### 3.1 Screen Setup
*   **Single Screen:** Aurora (Player, Left) and Umbra (NPC, Right) stand on a floating, moss-covered stone platform, facing each other.
*   **Health:** Both health bars are visible and cute, at the top corners (Aurora's is gold/white, Umbra's is purple/dark).

### 3.2 The Drawing System
Drawing is allowed in a dedicated, transparent bounding box that occupies the central third of the screen to minimize visual clutter.

*   **Rune Primitive Shapes:**

| Element | Primitive Shape | Description of Shape | Trail VFX Color |
| :--- | :--- | :--- | :--- |
| **Fire** | Triangle ($\Delta$) | One continuous stroke, roughly equilateral. | Glowing Orange/Red |
| **Wind** | Double Wave ( $\approx$ ) | Two sine-like wave lines stacked vertically. | Glowing White/Cyan |
| **Ice** | Five-point Star ($\star$) | A continuous five-pointed star. | Glowing Blue/White |
| **Earth** | Quad ([ ]) | A rough square or rectangle. | Glowing Brown/Grey |

### 3.3 Shape Detection Algorithm
*   **Library:** It is highly recommended to use a lightweight gesture recognition library like the **$1 Unistroke Recognizer** (or a port) during the jam. This algorithm is very efficient and excellent at recognizing simple geometric shapes from rough input.
*   **Refinement:** Test and refine the detection to ensure it is forgiving. If detection is too strict, players will get frustrated.

### 3.4 Inventory and Casting Mechanics
*   **Prepare:** A successfully drawn rune appears in the first available slot above the player's unicorn. Maximum 3 slots.
*   **Observe NPC:** Ghostly outlines of the NPC's forming runes are visible above their slots, becoming solid and purple once complete.
*   **CAST (Label: "[Space] to cast"):**

| Action | Control Method | Description |
| :--- | :--- | :--- |
| **CAST (Onscreen)** | Click/Tap labeled button | Combine and cast all currently stored runes. |
| **CAST (Keyboard)** | Space, Enter, or E key | Combine and cast all currently stored runes. |

**Important:** Casting activates *all* stored runes at once, regardless of how many are stored.

---

## 4. The Spell Combination Matrix

The power and effect of a spell are determined by the count and type of the combined runes.

| Rune Combo | Spell Name | Type | Description | Casting/Impact VFX |
| :--- | :--- | :--- | :--- | :--- |
| **$\Delta$** | Fire Bolt | Offense | Fast projectile, small damage. | Single cel-shaded fireball. |
| **$\Delta \Delta$** | Fire Storm | Offense | Field of fire on enemy side, small DOT. | Ground glows red, fire block textures. |
| **$\Delta \Delta \Delta$** | Fire Rain | Offense | High damage, 2-sec delay on impact. | Sky turns orange, fire blocks fall. |
| **$\Delta + \approx$** | Fire Ball | Combo-Offense | Slower projectile, medium damage. | A large, swirling orange/white ball. |
| **O O** | Wind Barrier | Utility | Protects against projectiles for 6 sec. | Shimmering air sphere around caster. |
| **O + O** | Wind Bolt | Utility | Very fast, brief pushback on enemy. | A swirling white blur. |
| **[ ]** | Earth Barrier| Defense | 2-sec complete protection (all sources). | Stacked crumbled earth blocks. |
| **[ ] + [ ]** | Earth Shard | Combo-Offense | Slow projectile, medium damage. | Spiky brown block launch. |
| **[ ] + $\Delta$** | Magma Shard | Combo-Offense | Medium damage + 2 sec burn DOT. | Glowing orange spiky block. |
| **$\star$** | Ice Bolt | Offense | Fast projectile, small damage. | Spiky blue ice block launch. |
| **$\star \star$** | Ice Pillar | Defense | A stationary pillar, blocks 1 projectile. | Spiky blue ice block texture. |
| **$\star \star \star$** | Blizzard | Combo-Offense | Wide area damage, 3s slowdown (non-stacking).| Swirling blue/white snow blocks. |
| **$\star + \Delta$** | Frostfire Ball| Combo-Offense | Slower than bolt, larger damage, small slowdown.| Glowing blue/orange swirling ball.|

---

## 5. UI/UX Flow

### 5.1 Main Menu
*   **Visuals:** Hand-drawn platform with the two unicorns standing in neutral poses. cloudy, dark background.
*   **Buttons:**
    *   **START DUEL:** Initiates battle.
    *   **SPELLBOOK:** Opens the spell list modal.

### 5.2 Spellbook Modal (The Menu/Modal)
*   **Visuals:** A cute, open ancient tome texture.
*   **Content:** A simple grid showing all found combinations. Combinations the player hasn't seen are greyed out with question mark shapes (e.g., `[?] + [?] + [?] = Blizzard`).
*   **Example:** It shows: `[Triangle] + [Triangle] = Fire Storm (Small DOT)`.

### 5.3 Battle Screen HUD
1.  **HP Bars:** Aurora (Left Top, gold), Umbra (Right Top, purple).
2.  **Player Slots:** Three slots above Aurora (visible empty/full).
3.  **NPC Slots:** Three slots above Umbra (visible ghostly/solid purple).
4.  **Drawing Area:** A transparent bounding box in the center.
5.  **Cast Button:** Bottom center, labeled "[Space] to cast".
6.  **Spellbook Button:** Top center, small book icon.
7.  **Discard Button:** Bottom left, small trash icon (Optional, for clearing player queue).

## 6 Rune Detection and Feedback
Try to implement a gesture recognition system that is forgiving and responsive. The rune detection should provide immediate visual feedback, such as a glowing outline or particle trail, 
to indicate successful recognition. If the drawn rune is not recognized, provide subtle feedback (like a shake or color change) to encourage the player to try again without frustration.
the algorithm does not need to be perfect, but the shapes are quite easy basic shapes, so it should be relatively easy to implement.