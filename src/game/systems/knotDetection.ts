import type { ChainLink } from "../core/types";
import {
  hasObviousSelfIntersection,
  polygonArea,
  polygonCentroid,
  segmentIntersection,
  simplifyPath,
} from "../geometry/polygon";
import { dist, type Vec2 } from "../geometry/vector";

export type SelfKnot = {
  polygon: Vec2[];
  area: number;
  center: Vec2;
  intersection: Vec2;
  crossedIndex: number;
  span: number;
};

export type KnotCandidateResult = SelfKnot;

type DetectionOptions = {
  protectedLinks: number;
  minSpan: number;
  minArea: number;
  forgiveness: number;
};

export const detectSelfKnot = (
  chain: ChainLink[],
  options: DetectionOptions,
): SelfKnot | null => {
  if (chain.length < options.protectedLinks + options.minSpan + 2) {
    return null;
  }

  return (
    detectMovingSegmentKnot(chain, 0, options, "crossing") ??
    detectMovingSegmentKnot(chain, 1, options, "crossing") ??
    detectCurrentFirstSegmentKnot(chain, options, "crossing")
  );
};

export const detectKnotCandidate = (
  chain: ChainLink[],
  options: DetectionOptions,
): KnotCandidateResult | null => {
  if (chain.length < options.protectedLinks + options.minSpan + 2) {
    return null;
  }

  return (
    detectMovingSegmentKnot(chain, 0, options, "candidate") ??
    detectMovingSegmentKnot(chain, 1, options, "candidate") ??
    detectCurrentFirstSegmentKnot(chain, options, "candidate")
  );
};

type DetectionMode = "crossing" | "candidate";

const detectMovingSegmentKnot = (
  chain: ChainLink[],
  movingIndex: 0 | 1,
  options: DetectionOptions,
  mode: DetectionMode,
): SelfKnot | null => {
  const mover = chain[movingIndex];

  if (!mover || dist(mover.prev, mover.pos) < 0.035) {
    return null;
  }

  const earliestSegment = Math.max(
    options.protectedLinks,
    movingIndex + options.minSpan,
  );

  for (
    let segmentIndex = earliestSegment;
    segmentIndex < chain.length - 1;
    segmentIndex += 1
  ) {
    const a = chain[segmentIndex];
    const b = chain[segmentIndex + 1];

    if (!a || !b) {
      continue;
    }

    const preciseIntersection = segmentIntersection(
      mover.prev,
      mover.pos,
      a.pos,
      b.pos,
    );
    const nearIntersection =
      preciseIntersection ??
      (mode === "candidate"
        ? nearSegmentClosure(mover.pos, a.pos, b.pos, options.forgiveness)
        : nearSegmentSweep(
            mover.prev,
            mover.pos,
            a.pos,
            b.pos,
            crossingForgiveness(options),
          ));
    const intersection = nearIntersection;

    if (!intersection) {
      continue;
    }

    const polygon = buildKnotPolygon(
      chain,
      movingIndex,
      segmentIndex,
      intersection,
    );
    const span = segmentIndex - movingIndex;
    const area = polygonArea(polygon);

    if (
      span >= options.minSpan &&
      area >= options.minArea &&
      polygon.length >= 4 &&
      !hasObviousSelfIntersection(polygon)
    ) {
      return {
        polygon,
        area,
        center: polygonCentroid(polygon),
        intersection,
        crossedIndex: segmentIndex,
        span,
      };
    }
  }

  return null;
};

const detectCurrentFirstSegmentKnot = (
  chain: ChainLink[],
  options: DetectionOptions,
  mode: DetectionMode,
): SelfKnot | null => {
  const head = chain[0];
  const first = chain[1];

  if (!head || !first) {
    return null;
  }

  const earliestSegment = Math.max(options.protectedLinks, options.minSpan);

  for (
    let segmentIndex = earliestSegment;
    segmentIndex < chain.length - 1;
    segmentIndex += 1
  ) {
    const a = chain[segmentIndex];
    const b = chain[segmentIndex + 1];

    if (!a || !b) {
      continue;
    }

    const intersection =
      segmentIntersection(head.pos, first.pos, a.pos, b.pos) ??
      (mode === "candidate"
        ? nearSegmentClosure(head.pos, a.pos, b.pos, options.forgiveness)
        : nearSegmentSweep(
            head.pos,
            first.pos,
            a.pos,
            b.pos,
            crossingForgiveness(options),
          ));

    if (!intersection) {
      continue;
    }

    const polygon = buildKnotPolygon(chain, 0, segmentIndex, intersection);
    const span = segmentIndex;
    const area = polygonArea(polygon);

    if (
      span >= options.minSpan &&
      area >= options.minArea &&
      polygon.length >= 4
    ) {
      return {
        polygon,
        area,
        center: polygonCentroid(polygon),
        intersection,
        crossedIndex: segmentIndex,
        span,
      };
    }
  }

  return null;
};

const nearSegmentClosure = (
  point: Vec2,
  a: Vec2,
  b: Vec2,
  forgiveness: number,
): Vec2 | null => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const lengthSq = ab.x * ab.x + ab.y * ab.y;

  if (lengthSq < 0.0001) {
    return null;
  }

  const amount = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSq),
  );
  const closest = {
    x: a.x + ab.x * amount,
    y: a.y + ab.y * amount,
  };

  return dist(point, closest) <= forgiveness ? closest : null;
};

const nearSegmentSweep = (
  start: Vec2,
  end: Vec2,
  a: Vec2,
  b: Vec2,
  forgiveness: number,
): Vec2 | null => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const move = { x: end.x - start.x, y: end.y - start.y };
  const lengthSq = ab.x * ab.x + ab.y * ab.y;
  const moveSq = move.x * move.x + move.y * move.y;

  if (lengthSq < 0.0001 || moveSq < 0.0001) {
    return null;
  }

  const sideStart = cross(ab, { x: start.x - a.x, y: start.y - a.y });
  const sideEnd = cross(ab, { x: end.x - a.x, y: end.y - a.y });

  if (sideStart * sideEnd > 0) {
    return null;
  }

  const amount = Math.max(
    -forgiveness / Math.sqrt(lengthSq),
    Math.min(
      1 + forgiveness / Math.sqrt(lengthSq),
      ((end.x - a.x) * ab.x + (end.y - a.y) * ab.y) / lengthSq,
    ),
  );
  const closest = {
    x: a.x + ab.x * Math.max(0, Math.min(1, amount)),
    y: a.y + ab.y * Math.max(0, Math.min(1, amount)),
  };

  return dist(end, closest) <= forgiveness ? closest : null;
};

const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

const crossingForgiveness = (options: DetectionOptions): number =>
  Math.min(options.forgiveness * 0.55, 0.62);

const buildKnotPolygon = (
  chain: ChainLink[],
  movingIndex: 0 | 1,
  crossedIndex: number,
  intersection: Vec2,
): Vec2[] => {
  const polygon: Vec2[] = [{ ...intersection }];

  for (let index = crossedIndex; index >= movingIndex; index -= 1) {
    const link = chain[index];

    if (link) {
      polygon.push({ ...link.pos });
    }
  }

  if (movingIndex === 1 && chain[0]) {
    polygon.push({ ...chain[0].pos });
  }

  return simplifyPath(polygon, 0.08);
};
