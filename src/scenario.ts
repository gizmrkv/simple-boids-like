import type { Program } from './perception';
import type { World } from './world';

export interface WinStatus {
  won: boolean;
  detail: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  createWorld: () => World;
  program: Program;
  checkWin: (world: World) => WinStatus;
}
