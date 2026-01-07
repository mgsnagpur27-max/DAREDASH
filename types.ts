
export enum GamePhase {
  INTRO = 'INTRO',
  SETUP = 'SETUP',
  MULTIPLAYER_LOBBY = 'MULTIPLAYER_LOBBY',
  TOSS = 'TOSS',
  LEVEL = 'LEVEL',
  CHOICE = 'CHOICE',
  GRID = 'GRID',
  RESULT = 'RESULT'
}

export enum GameLevel {
  CHILL = 'CHILL',
  SPICY = 'SPICY',
  EXTREME = 'EXTREME'
}

export enum GameType {
  TRUTH = 'TRUTH',
  DARE = 'DARE'
}

export interface GameState {
  phase: GamePhase;
  p1Name: string;
  p2Name: string;
  winner: string | null;
  level: GameLevel | null;
  type: GameType | null;
  selectedContent: string | null;
  gridContent: string[];
  isOnline: boolean;
  isHost: boolean;
  peerId: string | null;
  connected: boolean;
}
