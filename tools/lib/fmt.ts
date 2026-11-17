/**
 * Number formatting that matches Python's, because these tools replaced Python
 * ones and their output is diffed against the originals.
 *
 * `toFixed` is not a drop-in. Both round the exact binary value, but they
 * disagree on an exact tie: Python rounds to even, JavaScript rounds away from
 * zero, so `(8.5).toFixed(0)` is "9" where Python's `.0f` is "8". Intl's
 * `roundingMode: 'halfEven'` fixes the tie but rounds the shortest
 * representation instead of the exact value, which breaks `3.45` at one digit.
 */

/** Python's `f'{value:.{digits}f}'`. */
export function fixed(value: number, digits: number): string {
  // Exact, not rounded: a double's expansion terminates well inside 60 extra
  // digits for any magnitude these tools deal with.
  const exact = Math.abs(value).toFixed(Math.min(100, digits + 60));
  const cut = exact.indexOf('.') + 1 + digits;
  const tail = exact.slice(cut).replace(/0+$/, '');
  if (tail !== '5') {
    // Not a tie, so toFixed is already right — except that it drops the sign of
    // negative zero, which Python keeps.
    const text = value.toFixed(digits);
    return Object.is(value, -0) ? `-${text}` : text;
  }

  const kept = exact.slice(0, cut).replace(/\.$/, '');
  const lastDigit = Number(kept[kept.length - 1]);
  const rounded = lastDigit % 2 === 0 ? kept : increment(kept);
  return value < 0 || Object.is(value, -0) ? `-${rounded}` : rounded;
}

/** Python's `f'{value:+.{digits}f}'` — an explicit sign, including on zero. */
export function signed(value: number, digits: number): string {
  const text = fixed(value, digits);
  return text.startsWith('-') ? text : `+${text}`;
}

/** Python's `f'{value:g}'` — 6 significant digits, trailing zeros stripped. */
export function general(value: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';

  const exponent = Number(value.toExponential(5).split('e')[1]);
  if (exponent >= -4 && exponent < 6) return trimZeros(fixed(value, Math.max(0, 5 - exponent)));

  const mantissa = trimZeros(value.toExponential(5).split('e')[0]!);
  const sign = exponent < 0 ? '-' : '+';
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
}

/** The pass/fail marker used by every report; both branches are 4 wide. */
export const verdict = (ok: boolean): string => (ok ? 'ok  ' : 'FAIL');

function increment(decimal: string): string {
  const digits = [...decimal];
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] === '.') continue;
    if (digits[i] === '9') {
      digits[i] = '0';
      continue;
    }
    digits[i] = String(Number(digits[i]) + 1);
    return digits.join('');
  }
  return `1${digits.join('')}`;
}

const trimZeros = (decimal: string): string =>
  decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal;

/** Python's `str(float)` — a float always shows a decimal point, so 3 is "3.0". */
export function float(value: number): string {
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}
