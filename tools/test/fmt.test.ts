import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fixed, general, signed, verdict } from '../lib/fmt.ts';

/**
 * Expectations captured from CPython 3.11 — `f'{value:.{digits}f}'`. The rows
 * that matter are the ones where `toFixed` or Intl's halfEven disagree; they
 * are marked.
 */
const FIXED: ReadonlyArray<readonly [value: number, digits: number, expected: string]> = [
  [0.25, 2, '0.25'],
  [0.25, 1, '0.2'], // toFixed says 0.3
  [0.25, 0, '0'],
  [0.75, 1, '0.8'],
  [8.5, 2, '8.50'],
  [8.5, 0, '8'], // toFixed says 9
  [162.5, 0, '162'], // toFixed says 163
  [-0.125, 2, '-0.12'], // toFixed says -0.13
  [-0.125, 1, '-0.1'],
  [-0.125, 0, '-0'],
  [2.675, 2, '2.67'], // Intl halfEven says 2.68
  [0.005, 2, '0.01'], // Intl halfEven says 0.00
  [0.15, 1, '0.1'], // Intl halfEven says 0.2
  [3.45, 1, '3.5'], // Intl halfEven says 3.4
  [1.005, 2, '1.00'],
  [0.0, 2, '0.00'],
  [-0.0, 2, '-0.00'],
  [-0.001, 2, '-0.00'],
  [0.999, 2, '1.00'],
  [9.95, 1, '9.9'],
  [0.045, 2, '0.04'],
  [1e-9, 3, '0.000'],
  [82349.712345, 1, '82349.7'],
  [-195.48999999999998, 2, '-195.49'],
];

describe('fixed', () => {
  for (const [value, digits, expected] of FIXED) {
    it(`${value} at ${digits} -> ${expected}`, () => assert.equal(fixed(value, digits), expected));
  }

  it('agrees with toFixed away from exact ties', () => {
    for (let i = 0; i < 5000; i++) {
      const value = (Math.random() - 0.5) * 600;
      for (const digits of [0, 1, 2, 3]) {
        const mine = fixed(value, digits);
        // A random double is never an exact tie, so the two must agree.
        assert.equal(mine, value.toFixed(digits), `${value} at ${digits}`);
      }
    }
  });
});

describe('signed', () => {
  const cases: ReadonlyArray<readonly [number, number, string]> = [
    [0, 2, '+0.00'],
    [8.25, 2, '+8.25'],
    [-2.55, 2, '-2.55'],
    [-6.15, 2, '-6.15'],
    [3, 2, '+3.00'],
  ];
  for (const [value, digits, expected] of cases) {
    it(`${value} -> ${expected}`, () => assert.equal(signed(value, digits), expected));
  }
});

describe('general', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [140, '140'],
    [-160, '-160'],
    [-162.5, '-162.5'],
    [0, '0'],
    [10, '10'],
    [2.5, '2.5'],
    [0.30000000000000004, '0.3'],
    [1 / 3, '0.333333'],
    [0.0001, '0.0001'],
    [0.00001, '1e-05'],
    [999999, '999999'],
    [1234567, '1.23457e+06'],
  ];
  for (const [value, expected] of cases) {
    it(`${value} -> ${expected}`, () => assert.equal(general(value), expected));
  }
});

describe('verdict', () => {
  it('pads ok to the width of FAIL', () => {
    assert.equal(verdict(true), 'ok  ');
    assert.equal(verdict(false), 'FAIL');
  });
});
