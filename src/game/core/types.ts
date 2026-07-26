import type { Vec2 } from "../geometry/vector";

export type CellType = "hunter" | "platelet" | "fever";

export type LinkKind = "starter" | "hunter" | "platelet" | "fever";

export type Cell = {
  id: number;
  type: CellType;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  phase: number;
  highlighted: boolean;
  captured: boolean;
  tutorial?: boolean;
};

export type FocusState = {
  active: boolean;
  screen: Vec2;
  world: Vec2;
  radius: number;
  influencedIds: number[];
  pulse: number;
};

export type ChainLink = {
  pos: Vec2;
  prev: Vec2;
  kind: LinkKind;
  mass: number;
  dead: boolean;
};

export type Scar = {
  pos: Vec2;
  radius: number;
  life: number;
  maxLife: number;
};

export type Particle = {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  color: string;
};

export type Cutter = {
  pos: Vec2;
  vel: Vec2;
  cooldown: number;
  alive: boolean;
  target: CutterTarget | null;
  telegraph: number;
};

export type CutterTarget = {
  index: number;
  point: Vec2;
};

export type ObserverAttack = {
  pos: Vec2;
  life: number;
  maxLife: number;
  telegraph: number;
  radius: number;
  hit: boolean;
  demo: boolean;
};

export type HostCore = {
  pos: Vec2;
  radius: number;
  pulse: number;
  state: "dormant" | "binding" | "bound";
  bindProgress: number;
};

export type KnotState =
  | {
      mode: "idle";
    }
  | {
      mode: "capturing";
      polygon: Vec2[];
      area: number;
      center: Vec2;
      progress: number;
      hitStop: number;
      capturedIds: number[];
      includesCutter: boolean;
      includesCore: boolean;
    };

export type KnotCandidate = {
  targetIndex: number;
  point: Vec2;
  polygon: Vec2[];
  center: Vec2;
  area: number;
  cellIds: number[];
  previewCount: number;
  includesCore: boolean;
  tutorial: boolean;
  pulse: number;
};

export type Player = {
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  radius: number;
  dashCooldown: number;
  dashImpulse: number;
};
