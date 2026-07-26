import { dist, lerpVec, type Vec2 } from "./vector";

export const pathLength = (points: Vec2[]): number => {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += dist(points[index - 1], points[index]);
  }

  return total;
};

export const polygonArea = (points: Vec2[]): number => {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }

  return Math.abs(area) * 0.5;
};

export const polygonCentroid = (points: Vec2[]): Vec2 => {
  if (points.length === 0) {
    return { x: 16, y: 16 };
  }

  let x = 0;
  let y = 0;

  for (const point of points) {
    x += point.x;
    y += point.y;
  }

  return { x: x / points.length, y: y / points.length };
};

export const pointInPolygon = (point: Vec2, polygon: Vec2[]): boolean => {
  let inside = false;

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y + Number.EPSILON) +
          currentPoint.x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
};

export const simplifyPath = (points: Vec2[], minDistance: number): Vec2[] => {
  if (points.length < 3) {
    return points;
  }

  const simplified: Vec2[] = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    if (dist(simplified[simplified.length - 1], points[index]) >= minDistance) {
      simplified.push(points[index]);
    }
  }

  simplified.push(points[points.length - 1]);

  return simplified;
};

const orientation = (a: Vec2, b: Vec2, c: Vec2): number =>
  (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const segmentsIntersect = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  return o1 * o2 < 0 && o3 * o4 < 0;
};

export const hasObviousSelfIntersection = (points: Vec2[]): boolean => {
  if (points.length < 6) {
    return false;
  }

  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      const adjacent =
        first === 0 && second === points.length - 2
          ? true
          : Math.abs(first - second) <= 1;

      if (
        !adjacent &&
        segmentsIntersect(
          points[first],
          points[first + 1],
          points[second],
          points[second + 1],
        )
      ) {
        return true;
      }
    }
  }

  return false;
};

export const samplePathFromEnd = (
  points: Vec2[],
  distanceFromEnd: number,
): Vec2 => {
  if (points.length === 0) {
    return { x: 16, y: 16 };
  }

  let remaining = distanceFromEnd;

  for (let index = points.length - 1; index > 0; index -= 1) {
    const current = points[index];
    const previous = points[index - 1];
    const segmentLength = dist(current, previous);

    if (remaining <= segmentLength) {
      const amount = segmentLength === 0 ? 0 : remaining / segmentLength;

      return lerpVec(current, previous, amount);
    }

    remaining -= segmentLength;
  }

  return points[0];
};
