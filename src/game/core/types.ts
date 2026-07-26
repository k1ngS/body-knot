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
  targetIndex: number;
};

export type ObserverAttack = {
  pos: Vec2;
  life: number;
  maxLife: number;
  hit: boolean;
};

export type LassoState =
  | {
      mode: "idle";
    }
  | {
      mode: "anchored";
      anchor: Vec2;
      path: Vec2[];
      length: number;
      tension: number;
    }
  | {
      mode: "closed";
      anchor: Vec2;
      path: Vec2[];
      polygon: Vec2[];
      area: number;
      center: Vec2;
      progress: number;
    };

export type Player = {
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  radius: number;
  dashCooldown: number;
  dashImpulse: number;
};
