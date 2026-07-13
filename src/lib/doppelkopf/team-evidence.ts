import type {
  AnnouncementRecord,
  BotView,
  GameMode,
  GameState,
  Seat,
  Team,
  TrickPlay,
  TrickResult,
} from "./types";

type HardTeam = Team | "unknown";

type TeamEvidenceInput = {
  gameMode: GameMode;
  announcements: AnnouncementRecord[];
  completedTricks: TrickResult[];
  currentTrick: TrickPlay[];
};

const SEATS: Seat[] = [0, 1, 2, 3];

function unknownTeams(): Record<Seat, HardTeam> {
  return {
    0: "unknown",
    1: "unknown",
    2: "unknown",
    3: "unknown",
  };
}

function setTeamIfUnknown(
  teams: Record<Seat, HardTeam>,
  seat: Seat,
  team: Team,
): void {
  if (teams[seat] === "unknown") teams[seat] = team;
}

function deduceRemainingTeams(teams: Record<Seat, HardTeam>): void {
  const knownRe = SEATS.filter((seat) => teams[seat] === "re").length;
  const knownKontra = SEATS.filter((seat) => teams[seat] === "kontra").length;
  if (knownRe === 2) {
    for (const seat of SEATS) {
      if (teams[seat] === "unknown") teams[seat] = "kontra";
    }
  } else if (knownKontra === 3) {
    for (const seat of SEATS) {
      if (teams[seat] === "unknown") teams[seat] = "re";
    }
  }
}

function countPlayedReQueens(input: TeamEvidenceInput): Record<Seat, number> {
  const out: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const plays = [
    ...input.completedTricks.flatMap((trick) => trick.plays),
    ...input.currentTrick,
  ];
  for (const play of plays) {
    if (!play.wasLegal) continue;
    if (play.card.suit === "clubs" && play.card.rank === "Q") {
      out[play.seat] = Math.min(2, out[play.seat] + 1);
    }
  }
  return out;
}

export function computeHardPublicTeams(
  input: TeamEvidenceInput,
): Record<Seat, HardTeam> {
  const teams = unknownTeams();

  if (input.gameMode.kind === "solo") {
    for (const seat of SEATS) {
      teams[seat] = seat === input.gameMode.soloSeat ? "re" : "kontra";
    }
    return teams;
  }

  if (input.gameMode.kind === "marriage") {
    teams[input.gameMode.holderSeat] = "re";
    if (input.gameMode.partnerSeat !== null) {
      teams[input.gameMode.partnerSeat] = "re";
      for (const seat of SEATS) {
        if (teams[seat] === "unknown") teams[seat] = "kontra";
      }
      return teams;
    }
    if (input.gameMode.forced) {
      for (const seat of SEATS) {
        if (seat !== input.gameMode.holderSeat) teams[seat] = "kontra";
      }
      return teams;
    }
  }

  if (input.gameMode.kind === "poverty") {
    teams[input.gameMode.povertySeat] = "re";
    if (input.gameMode.acceptedBySeat !== null) {
      teams[input.gameMode.acceptedBySeat] = "re";
      for (const seat of SEATS) {
        if (teams[seat] === "unknown") teams[seat] = "kontra";
      }
      return teams;
    }
  }

  for (const announcement of input.announcements) {
    setTeamIfUnknown(teams, announcement.seat, announcement.team);
  }

  if (input.gameMode.kind === "normal") {
    const playedQueens = countPlayedReQueens(input);
    let totalPlayed = 0;
    const queenOwners: Seat[] = [];
    for (const seat of SEATS) {
      const count = playedQueens[seat];
      if (count > 0) {
        setTeamIfUnknown(teams, seat, "re");
        queenOwners.push(seat);
      }
      totalPlayed += count;
    }

    if (totalPlayed >= 2) {
      if (queenOwners.length === 1) {
        for (const seat of SEATS) {
          if (seat !== queenOwners[0]) setTeamIfUnknown(teams, seat, "kontra");
        }
      } else if (queenOwners.length === 2) {
        for (const seat of SEATS) {
          if (!queenOwners.includes(seat))
            setTeamIfUnknown(teams, seat, "kontra");
        }
      }
    }
  }

  deduceRemainingTeams(teams);
  return teams;
}

export function computeHardPublicTeamsFromView(
  view: Pick<
    BotView,
    "gameMode" | "announcements" | "completedTricks" | "currentTrick"
  >,
): Record<Seat, HardTeam> {
  return computeHardPublicTeams({
    gameMode: view.gameMode,
    announcements: view.announcements,
    completedTricks: view.completedTricks,
    currentTrick: view.currentTrick,
  });
}

export function computeHardPublicTeamsFromState(
  state: Pick<
    GameState,
    "gameMode" | "announcements" | "completedTricks" | "trick"
  >,
): Record<Seat, HardTeam> {
  return computeHardPublicTeams({
    gameMode: state.gameMode,
    announcements: state.announcements,
    completedTricks: state.completedTricks,
    currentTrick: state.trick,
  });
}

export function computeHardPrivateTeamsFromView(
  view: Pick<BotView, "seat" | "hand" | "gameMode">,
): Record<Seat, HardTeam> {
  const teams = unknownTeams();
  if (view.gameMode.kind !== "normal") return teams;

  const myReQueens = view.hand.filter(
    (card) => card.suit === "clubs" && card.rank === "Q",
  ).length;
  teams[view.seat] = myReQueens === 0 ? "kontra" : "re";
  return teams;
}

export function computeHardTeamEvidence(
  view: Pick<
    BotView,
    | "seat"
    | "hand"
    | "gameMode"
    | "announcements"
    | "completedTricks"
    | "currentTrick"
  >,
): {
  public: Record<Seat, HardTeam>;
  private: Record<Seat, HardTeam>;
  merged: Record<Seat, HardTeam>;
} {
  const publicTeams = computeHardPublicTeamsFromView(view);
  const privateTeams = computeHardPrivateTeamsFromView(view);
  const merged = unknownTeams();
  for (const seat of SEATS) {
    merged[seat] =
      publicTeams[seat] !== "unknown" ? publicTeams[seat] : privateTeams[seat];
  }
  return {
    public: publicTeams,
    private: privateTeams,
    merged,
  };
}
