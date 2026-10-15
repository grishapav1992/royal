// Source: vfair-games/libs/game-math/src/decimal.ts (Apache-2.0).
// Vendored for Royal; attribution header added, upstream math below is unchanged.
// See public/licenses/vfair/LICENSE.txt and provenance in public/licenses/upstream-games.json.
export const toMinorUnits = (value: number, decimalPlaces: number): number => {
  if (!Number.isFinite(value)) {
    return NaN;
  }

  const [coefficient, exponent = '0'] = value.toExponential().split('e');
  return Math.round(
    Number(`${coefficient}e${Number(exponent) + decimalPlaces}`),
  );
};

export const fromMinorUnits = (
  minorUnits: number,
  decimalPlaces: number,
): number => Number(`${minorUnits}e-${decimalPlaces}`);

export const roundToDecimals = (value: number, decimalPlaces: number): number =>
  fromMinorUnits(toMinorUnits(value, decimalPlaces), decimalPlaces);

type ScaledDecimal = {
  value: number;
  decimals: number;
};

export const multiplyDecimals = (
  left: ScaledDecimal,
  right: ScaledDecimal,
  resultDecimals: number,
): number => {
  const leftMinor = toMinorUnits(left.value, left.decimals);
  const rightMinor = toMinorUnits(right.value, right.decimals);
  const scale = 10 ** (left.decimals + right.decimals - resultDecimals);
  const productMinor = Math.round((leftMinor * rightMinor) / scale);
  return fromMinorUnits(productMinor, resultDecimals);
};
