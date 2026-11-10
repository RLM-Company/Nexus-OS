export interface Glicko2PlayerState {
  playerId: string;
  ratingR: number; // Standard scale (default 1500)
  ratingDeviationRd: number; // Standard scale (default 350)
  volatilitySigma: number; // Default 0.06
  matchesPlayed: number;
}

export interface MatchOutcomeSpec {
  opponentId: string;
  score: 1 | 0.5 | 0; // 1 = win, 0.5 = draw, 0 = loss
}

/**
 * Glickman's Glicko-2 Bayesian Skill Rating & Uncertainty Deviation System.
 * Tracks skill rating (R), epistemic rating deviation (RD), and volatility (sigma)
 * for ranking competing AI models, prompt variants, and specialized worker agents.
 */
export class Glicko2AndBradleyTerrySkillEngine {
  private static readonly SCALE_FACTOR = 173.7178;
  private readonly players = new Map<string, Glicko2PlayerState>();

  public ensurePlayer(
    playerId: string,
    initialRating = 1500,
    initialRd = 350,
    initialSigma = 0.06
  ): Glicko2PlayerState {
    let p = this.players.get(playerId);
    if (!p) {
      p = {
        playerId,
        ratingR: initialRating,
        ratingDeviationRd: initialRd,
        volatilitySigma: initialSigma,
        matchesPlayed: 0
      };
      this.players.set(playerId, p);
    }
    return p;
  }

  private static gFunction(phi: number): number {
    return 1.0 / Math.sqrt(1.0 + (3.0 * phi * phi) / (Math.PI * Math.PI));
  }

  private static expectedScoreE(mu: number, muJ: number, phiJ: number): number {
    return 1.0 / (1.0 + Math.exp(-Glicko2AndBradleyTerrySkillEngine.gFunction(phiJ) * (mu - muJ)));
  }

  public recordRatingPeriod(
    playerId: string,
    matches: MatchOutcomeSpec[]
  ): Glicko2PlayerState {
    const player = this.ensurePlayer(playerId);
    const S = Glicko2AndBradleyTerrySkillEngine.SCALE_FACTOR;

    const mu = (player.ratingR - 1500) / S;
    const phi = player.ratingDeviationRd / S;
    const sigma = player.volatilitySigma;

    if (matches.length === 0) {
      // Inactive period: epistemic uncertainty grows by volatility
      const phiStar = Math.sqrt(phi * phi + sigma * sigma);
      player.ratingDeviationRd = Number(Math.min(350, phiStar * S).toFixed(4));
      return { ...player };
    }

    let vInv = 0;
    let deltaSum = 0;

    for (const m of matches) {
      const opp = this.ensurePlayer(m.opponentId);
      const muJ = (opp.ratingR - 1500) / S;
      const phiJ = opp.ratingDeviationRd / S;
      const gJ = Glicko2AndBradleyTerrySkillEngine.gFunction(phiJ);
      const eJ = Glicko2AndBradleyTerrySkillEngine.expectedScoreE(mu, muJ, phiJ);

      vInv += gJ * gJ * eJ * (1.0 - eJ);
      deltaSum += gJ * (m.score - eJ);
    }

    const v = 1.0 / Math.max(1e-9, vInv);
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    const newPhi = 1.0 / Math.sqrt(1.0 / (phiStar * phiStar) + 1.0 / v);
    const newMu = mu + newPhi * newPhi * deltaSum;

    player.ratingR = Number((1500 + S * newMu).toFixed(4));
    player.ratingDeviationRd = Number((S * newPhi).toFixed(4));
    player.matchesPlayed += matches.length;

    return { ...player };
  }

  public getLeaderboard(): Glicko2PlayerState[] {
    return Array.from(this.players.values()).sort((a, b) => b.ratingR - a.ratingR);
  }
}
