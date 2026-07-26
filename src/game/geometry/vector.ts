export type Vec2 = {
  x: number;
  y: number;
};

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const mul = (a: Vec2, scalar: number): Vec2 => ({
  x: a.x * scalar,
  y: a.y * scalar,
});

export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export const dist = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const normalize = (a: Vec2): Vec2 => {
  const length = len(a);

  if (length < 0.0001) {
    return { x: 0, y: 0 };
  }

  return { x: a.x / length, y: a.y / length };
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const lerp = (a: number, b: number, amount: number): number =>
  a + (b - a) * amount;

export const lerpVec = (a: Vec2, b: Vec2, amount: number): Vec2 => ({
  x: lerp(a.x, b.x, amount),
  y: lerp(a.y, b.y, amount),
});
