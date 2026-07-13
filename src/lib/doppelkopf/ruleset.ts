import type { AnnouncementDeclaration, SoloType } from "./types";

/**
 * The high-level mode dictates which structural rules and meta-mechanics are available.
 * - "standard": Full Doppelkopf ruleset (solos, marriage, poverty, announcements, schmeißen enabled).
 * - "oblivious": Streamlined artifact mode (no chosen solos, no announcements, no poverty flow,
 *                no schmeißen; marriage is implicit 1v3 only).
 */
export type ExperienceMode = "standard" | "oblivious";

export type AnnouncementPolicy =
  | { mode: "disabled" }
  | {
      mode: "enabled";
      declarations: AnnouncementDeclaration[];
    };

export type SchweinePolicy =
  | { mode: "disabled" }
  | {
      mode: "announce_while_playing";
      announce: "manual" | "auto";
    };

export type SoloPolicy =
  | { mode: "disabled" }
  | {
      mode: "enabled";
      allowed: SoloType[];
    };

export interface Ruleset {
  experienceMode: ExperienceMode;
  announcements: AnnouncementPolicy;
  schweine: SchweinePolicy;
  solo: SoloPolicy;
  /**
   * If true, the UI is allowed to send illegal plays and the engine records them.
   * If false, the engine rejects illegal plays.
   */
  allowIllegalPlays: boolean;
  /**
   * Enable optional table callouts like Schweine. The 2026-02-16 artifact keeps
   * this off (no announcements).
   */
  enableCallouts: boolean;
  /**
   * If not disabled, the second Dulle (10 hearts) beats the first one.
   */
  dulleBeatsDulle: "disabled" | "always" | "except_last_trick";
  /**
   * If true, Schweine can be announced and have their power effect even in solo games.
   */
  schweineInSolo: boolean;
  /**
   * If true, players can throw their cards (Schmeißen) to force a redeal.
   */
  schmeissen: boolean;
}

export function rulesetStandard(): Ruleset {
  return {
    experienceMode: "standard",
    announcements: {
      mode: "enabled",
      declarations: ["Re", "Kontra", "No90", "No60", "No30", "Schwarz"],
    },
    schweine: { mode: "disabled" },
    solo: {
      mode: "enabled",
      allowed: [
        "queen_jack",
        "jack",
        "queen",
        "clubs",
        "spades",
        "hearts",
        "diamonds",
        "fleischlos",
      ],
    },
    allowIllegalPlays: false,
    enableCallouts: true,
    dulleBeatsDulle: "except_last_trick",
    schweineInSolo: false,
    schmeissen: true,
  };
}

export function rulesetObliviousDay(): Ruleset {
  return {
    experienceMode: "oblivious",
    announcements: { mode: "disabled" },
    schweine: { mode: "disabled" },
    solo: { mode: "disabled" },
    // 2026-02-16 UX: no meta systems (announcements, callouts, renonce audits).
    // Keep the engine capable elsewhere via other rulesets/modes.
    allowIllegalPlays: false,
    enableCallouts: false,
    dulleBeatsDulle: "except_last_trick",
    schweineInSolo: false,
    schmeissen: false,
  };
}
