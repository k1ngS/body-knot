import {
  CUTTER_COOLDOWN_SECONDS,
  CUTTER_TELEGRAPH_SECONDS,
  MIN_PLAYABLE_LINKS,
  PROTECTED_CHAIN_LINKS,
} from "../core/constants";
import type { ChainLink, CutterTarget } from "../core/types";
import type { Vec2 } from "../geometry/vector";

export type CutResult = {
  removed: ChainLink[];
  cutPoint: Vec2 | null;
};

export const findValidCutterTarget = (
  chain: ChainLink[],
  preferredIndex?: number,
): CutterTarget | null => {
  if (!canCutterThreaten(chain)) {
    return null;
  }

  const maxIndex = chain.length - 2;
  const fallbackIndex = Math.floor(chain.length * 0.72);
  const index = clampIndex(preferredIndex ?? fallbackIndex, maxIndex);
  const link = chain[index];
  const next = chain[index + 1];

  if (!link || !next) {
    return null;
  }

  return {
    index,
    point: {
      x: (link.pos.x + next.pos.x) * 0.5,
      y: (link.pos.y + next.pos.y) * 0.5,
    },
  };
};

export const isCutterTargetValid = (
  chain: ChainLink[],
  target: CutterTarget | null,
): target is CutterTarget => {
  if (!target || !canCutterThreaten(chain)) {
    return false;
  }

  return (
    Number.isInteger(target.index) &&
    target.index >= PROTECTED_CHAIN_LINKS &&
    target.index < chain.length - 1 &&
    chain[target.index] != null &&
    chain[target.index + 1] != null
  );
};

export const canCutterThreaten = (chain: ChainLink[]): boolean =>
  chain.length > MIN_PLAYABLE_LINKS + 2 &&
  chain.length - 2 >= PROTECTED_CHAIN_LINKS;

export const applySafeCut = (
  chain: ChainLink[],
  requestedIndex: number,
  requestedCount = 3,
): CutResult => {
  if (!canCutterThreaten(chain)) {
    return { removed: [], cutPoint: null };
  }

  const maxRemovable = chain.length - MIN_PLAYABLE_LINKS;
  const removeCount = Math.max(
    0,
    Math.min(3, requestedCount, maxRemovable, chain.length - requestedIndex),
  );
  const index = clampIndex(requestedIndex, chain.length - 1);

  if (removeCount <= 0 || !chain[index]) {
    return { removed: [], cutPoint: null };
  }

  const cutPoint = { ...chain[index].pos };
  const removed = chain.splice(index, removeCount);

  return { removed, cutPoint };
};

export const resetCutterTelegraph = (): {
  cooldown: number;
  target: null;
  telegraph: number;
} => ({
  cooldown: CUTTER_COOLDOWN_SECONDS,
  target: null,
  telegraph: 0,
});

export const cutterTelegraphReady = (telegraph: number): boolean =>
  telegraph >= CUTTER_TELEGRAPH_SECONDS;

export const runCutterLifecycleChecks = (): string[] => {
  const checks: Array<[string, () => boolean]> = [
    ["cutting near the tail keeps indices safe", checkTailCut],
    ["repeated cuts stop at playable minimum", checkRepeatedCuts],
    ["cutting after assimilation recomputes target", checkAssimilationCut],
    ["restart clears target and sever state", checkRestartShape],
    ["invalid target during update is rejected", checkInvalidSameCycleTarget],
  ];

  const failures = checks.filter(([, check]) => !check()).map(([name]) => name);

  if (failures.length > 0) {
    throw new Error(`Cutter lifecycle checks failed: ${failures.join(", ")}`);
  }

  return checks.map(([name]) => name);
};

const clampIndex = (index: number, maxIndex: number): number =>
  Math.max(PROTECTED_CHAIN_LINKS, Math.min(maxIndex, Math.floor(index)));

const fakeChain = (length: number): ChainLink[] =>
  Array.from({ length }, (_, index) => ({
    pos: { x: index, y: 0 },
    prev: { x: index, y: 0 },
    kind: "starter",
    mass: 1,
    dead: false,
  }));

const checkTailCut = () => {
  const chain = fakeChain(24);
  const result = applySafeCut(chain, 22, 3);

  return result.removed.length === 2 && chain.length === 22;
};

const checkRepeatedCuts = () => {
  const chain = fakeChain(23);
  let guard = 0;

  while (canCutterThreaten(chain) && guard < 20) {
    const target = findValidCutterTarget(chain);

    if (!target) {
      break;
    }

    applySafeCut(chain, target.index, 3);
    guard += 1;
  }

  return chain.length >= MIN_PLAYABLE_LINKS && guard > 0;
};

const checkAssimilationCut = () => {
  const chain = fakeChain(18);
  chain.push(...fakeChain(4));
  const target = findValidCutterTarget(chain, 999);

  if (!target || !isCutterTargetValid(chain, target)) {
    return false;
  }

  const result = applySafeCut(chain, target.index, 3);

  return (
    result.removed.length > 0 &&
    isCutterTargetValid(chain, findValidCutterTarget(chain, target.index))
  );
};

const checkRestartShape = () => {
  const cutter = resetCutterTelegraph();
  const severed: ChainLink[] = [];

  return (
    cutter.target === null && cutter.telegraph === 0 && severed.length === 0
  );
};

const checkInvalidSameCycleTarget = () => {
  const chain = fakeChain(MIN_PLAYABLE_LINKS + 3);
  const target = findValidCutterTarget(chain);

  if (!target) {
    return false;
  }

  applySafeCut(chain, target.index, 3);
  applySafeCut(chain, target.index, 3);

  return !isCutterTargetValid(chain, target) || chain[target.index] != null;
};
