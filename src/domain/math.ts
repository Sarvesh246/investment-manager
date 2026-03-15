export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function scaleSigned(value: number) {
  return clamp(value * 2 - 1, -1, 1);
}

export function toScore(value: number) {
  return clamp(50 + value * 50, 0, 100);
}

export function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

export function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentileRank(values: number[], value: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = sorted.findIndex((entry) => entry >= value);

  if (sorted.length <= 1) {
    return 0.5;
  }

  if (index === -1) {
    return 1;
  }

  return index / (sorted.length - 1);
}

export function meanAbsolute(values: number[]) {
  return average(values.map((value) => Math.abs(value)));
}

export function correlationCoefficient(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) {
    return 0;
  }

  const leftMean = average(left);
  const rightMean = average(right);
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }

  const denominator = Math.sqrt(leftVariance * rightVariance);

  if (denominator === 0) {
    return 0;
  }

  return clamp(numerator / denominator, -1, 1);
}
