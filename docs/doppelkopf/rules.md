# Doppelkopf — Rules Baseline (Turnier / DDV-TSR-ish)

This document is the **baseline ruleset** for the Doppelkopf engine in this repo.
It’s modeled after **Turnier-Spielregeln (DDV TSR) style scoring (PLUS/MINUS)** with a small number of explicit house rules and implementation simplifications, listed below.

## Engine Modes

The engine primarily targets two distinct modes of play:

### 1. Baseline Ruleset (`standard` mode)

- Full tournament-style play with supported house rules.
- **Chosen Solos:** Enabled.
- **Marriage (Hochzeit):** Supported and configurable.
- **Poverty (Armut):** Supported.
- **Schmeißen (Throwing Cards):** Supported.
- **Announcements:** Enabled.
- **Schweine:** Configurable via app settings.

### 2. Oblivious Artifact Mode (`oblivious` mode)

- A streamlined, minimal-UI experience retained as the legacy Oblivious preset.
- **Chosen Solos:** Disabled.
- **Marriage (Hochzeit):** Declarations disabled. A "silent marriage" (holding both Q♣) simply produces a 1v3 team split without a partner-finding phase.
- **Poverty (Armut):** Disabled.
- **Schmeißen (Throwing Cards):** Disabled.
- **Announcements:** Disabled.
- **Schweine:** Disabled.

---

## Card points (Augen)

Per card:

- A = 11
- 10 = 10
- K = 4
- Q (Dame) = 3
- J (Bube) = 2
- 9 = 0

Total per hand: **240 eyes**.

## Winner by eyes

- **Re wins with 121+** eyes.
- Otherwise **Kontra wins** (so **120:120 goes to Kontra**).

## Scoring model (PLUS/MINUS)

Each hand yields a single integer **hand value** `V`.

- In **Normalspiel (2v2)**: each player on the winning side gets `+V`, each player on the losing side gets `-V`.
- In **Solo (1v3)**: soloist gets `+3V` / `-3V`, each opponent gets `-V` / `+V`.

Internally we surface this as **per-player points per side**:

- `scoreRe.gamePoints` = points for each Re player (in solo-like games: points for the soloist side)
- `scoreKontra.gamePoints` = points for each Kontra player (in solo-like games: points per defender)

## Building the hand value `V`

### 1) Base and “won by margin”

Awarded to the winner:

- +1 for winning
- +1 each if the loser is held under: 90, 60, 30, schwarz (0)

### 2) Announcements (Re / Kontra)

If declared, they are **at stake** and count as:

- Re announced: +2
- Kontra announced: +2

(Both may be announced; both then count.)

### 3) Absagen (No90 / No60 / No30 / Schwarz)

For each absage tier in the declared chain:

- +1 for the tier, awarded to the side that **made** it; if the tier is **missed**, the opponent receives it.

### 4) “Gegen die Absage” points

If a side was absaged against but reaches the counter-threshold, it scores `+1` per achieved tier:

- vs No90: reach 120
- vs No60: reach 90
- vs No30: reach 60
- vs Schwarz: reach 30

## Sonderpunkte (normal games only)

Only in **Normalspiel** (including a resolved Hochzeit with a partner):

- +1 “gegen die Alten gewonnen” (Kontra wins)
- +1 Doppelkopf (a trick with 40+ eyes)
- +1 Fuchs gefangen (capturing opponent’s ♦A)
- +1 Karlchen (♣J wins the last trick)

Sonderpunkte can occur on either side and are **netted** into the hand value.

## Solo rules

In Solo (including “solo-like” cases below):

- **No Sonderpunkte**.
- Compute `V` from the game-point components only (base/margins + announcements + absagen + “gegen die Absage”).
- Settle as: soloist `±3V`, each opponent `∓V`.

## Hochzeit (Marriage)

### Partner finding

Announced Hochzeit starts as a partner-finding game for the first **3 tricks**.

Fixed house rule in this repo:

- The **Klärungsstich must be a Fehlstich**: partner can only be found on a trick where the **lead card is non-trump**.
- Partner is the first **non-holder seat** to win such a Fehlstich within the first 3 tricks.

### Hochzeit without clarification (“ohne Klärung”)

If no partner is found by the end of trick 3:

- the holder continues **alone** as a **Diamonds solo** (trump structure unchanged),
- and the hand is settled as **Solo** (no Sonderpunkte, solo settlement).

## Stille Hochzeit (Silent marriage)

If someone holds both club queens but does **not** announce Hochzeit:

- play proceeds as a 1v3 game,
- it is settled as **Solo** (no Sonderpunkte, solo settlement).

## Armut (Poverty) — supported house rule

DDV TSR does not define Armut. In this repo we still support it as a common house rule:

- Armut is treated as a **Normalspiel** for scoring (once accepted and played).
- **Sonderpunkte count** as usual.

## Schweine (Piglets) — triggerable house rule

Schweine (“Piglets”) are supported as a triggerable house rule:

- Condition: a seat holds **both trump aces** of the current trump suit
  - Normal / Marriage / Poverty: trump suit is **diamonds** (so this is ♦A♦A)
  - Suit solo: trump suit is the chosen suit
  - Rank solos / Fleischlos: no trump suit → Schweine cannot exist there
- Trigger: we use **announce-while-playing** (auto): when you play the trump ace, Schweine are announced.
- Effect: the trump aces of the trump suit become top trumps (engine “power” boost).

### Schweine options (app setting)

- **Disabled**: no Schweine.
- **Enabled (no soli)**: Schweine in regular games (Normalspiel, marriage variants, poverty); not in solo(-like) games.
- **Enabled (all games)**: Schweine also in **suit solos** (including Diamonds solo) and in solo-like cases (e.g. silent marriage).

## Schmeißen (Throwing Cards)

"Schmeißen" is implemented as a **baseline house rule** (optional via ruleset config, default `on` in `standard`).

- It is only available during the `solo_selection` phase.
- A player may throw their cards to force an immediate **redeal** if their hand meets one of the following criteria:
  - **5 Kings**
  - **8 Kings and Nines combined**

## Announcement Simplifications

The engine implements a few simplifications compared to strict tournament announcement rules:

- **No9 (Keine 9) is disabled:** The engine does not currently support the "No9" declaration.
- **Timing approximation:** Announcement timing windows are strictly approximated by the number of completed tricks (or remaining cards), rather than complex conversational interrupt flows.
- **Auto-chaining:** When a player declares an advanced tier (e.g., "No60"), the engine automatically materializes the prerequisite declarations (e.g., "Re" -> "No90" -> "No60").
- **Unresolved Marriage Blocks:** In an announced Marriage, players cannot make announcements until the partner is found. To prevent players from losing their timing windows, the engine shifts the announcement deadlines later by the number of tricks it took to find the partner (`announcementTrickOffset`).
