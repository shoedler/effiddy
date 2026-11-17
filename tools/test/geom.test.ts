import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bboxCovers,
  boundsOf,
  polygonContains,
  polygonDistance,
  polygonEdges,
  rectCorners,
  rotateCcw,
  rotateKicad,
  hypot,
  segmentPointDistance,
  segmentsCross,
  type Polygon,
  type Vec2,
} from '../lib/geom.ts';

const close = (actual: Vec2, expected: Vec2, message?: string) => {
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-9, `${message ?? ''} ${actual} != ${expected}`);
};

describe('the two rotation conventions', () => {
  it('disagree on the sign of y, which is the whole point', () => {
    close(rotateKicad([1, 0], 90), [0, -1], 'kicad');
    close(rotateCcw([1, 0], 90), [0, 1], 'ccw');
  });

  it('agree at 0 and 180', () => {
    for (const degrees of [0, 180]) close(rotateKicad([3, -7], degrees), rotateCcw([3, -7], degrees));
  });

  it('are each other transposed', () => {
    for (const degrees of [17, 90, -90, 234]) {
      const [x, y] = rotateKicad([3, -7], degrees);
      close(rotateCcw([3, -7], -degrees), [x, y]);
    }
  });

  it('round-trips through its own inverse', () => {
    close(rotateKicad(rotateKicad([2.5, 4.25], 37), -37), [2.5, 4.25]);
  });
});

describe('segmentPointDistance', () => {
  it('clamps to the segment rather than the infinite line', () => {
    assert.equal(segmentPointDistance([5, 0], [0, 0], [1, 0]), 4);
    assert.equal(segmentPointDistance([0.5, 2], [0, 0], [1, 0]), 2);
  });

  it('handles a degenerate segment', () => {
    assert.equal(segmentPointDistance([3, 4], [0, 0], [0, 0]), 5);
  });
});

describe('segmentsCross', () => {
  it('is true for a proper crossing', () => {
    assert.equal(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0]), true);
  });

  it('is false for collinear segments', () => {
    assert.equal(segmentsCross([0, 0], [2, 0], [2, 0], [4, 0]), false);
  });

  it('is true for a T-junction, because an endpoint lying on the other segment counts', () => {
    assert.equal(segmentsCross([0, 0], [2, 0], [1, 0], [1, 2]), true);
  });
});

describe('polygonContains', () => {
  // An L shape, to exercise the concave case.
  const shape: Polygon = [
    [0, 0],
    [4, 0],
    [4, 1],
    [1, 1],
    [1, 4],
    [0, 4],
  ];

  it('accepts points in both arms', () => {
    assert.equal(polygonContains(shape, [2, 0.5]), true);
    assert.equal(polygonContains(shape, [0.5, 3]), true);
  });

  it('rejects the notch', () => {
    assert.equal(polygonContains(shape, [3, 3]), false);
    assert.equal(polygonContains(shape, [5, 0.5]), false);
  });
});

describe('polygonDistance', () => {
  const square = (cx: number, cy: number, side: number): Polygon => rectCorners([side, side]).map(([x, y]) => [x + cx, y + cy]);

  it('measures the gap between disjoint polygons', () => {
    assert.ok(Math.abs(polygonDistance(square(0, 0, 2), square(5, 0, 2)) - 3) < 1e-9);
  });

  it('is zero when they touch', () => {
    assert.equal(polygonDistance(square(0, 0, 2), square(2, 0, 2)), 0);
  });

  it('is zero when they overlap', () => {
    assert.equal(polygonDistance(square(0, 0, 2), square(1, 0, 2)), 0);
  });

  it('is zero when one is nested inside the other', () => {
    assert.equal(polygonDistance(square(0, 0, 10), square(0, 0, 2)), 0);
    assert.equal(polygonDistance(square(0, 0, 2), square(0, 0, 10)), 0);
  });
});

describe('polygonEdges', () => {
  it('closes the loop', () => {
    const edges = polygonEdges(rectCorners([2, 2]));
    assert.equal(edges.length, 4);
    assert.deepEqual(edges[3]![1], rectCorners([2, 2])[0]);
  });
});

describe('boundsOf / bboxCovers', () => {
  it('is null for nothing', () => assert.equal(boundsOf([]), null));

  it('covers only when every side is outside', () => {
    const outer = boundsOf(rectCorners([10, 10]))!;
    assert.equal(bboxCovers(outer, boundsOf(rectCorners([2, 2]))!), true);
    assert.equal(bboxCovers(outer, boundsOf(rectCorners([20, 2]))!), false);
  });
});

describe('hypot', () => {
  it('matches Python on the cases where the naive forms do not', () => {
    // Captured from CPython 3.11's math.hypot.
    assert.equal(hypot(3, 4), 5);
    assert.equal(hypot(0, 0), 0);
    assert.equal(hypot(-5, 0), 5);
    assert.equal(hypot(1, 1), 1.4142135623730951);
    assert.equal(hypot(1e300, 1e300), 1.4142135623730952e300);
    assert.equal(hypot(1e-320, 1e-320), 1.414e-320);
    assert.equal(hypot(Infinity, 1), Infinity);
    assert.ok(Number.isNaN(hypot(NaN, 1)));
  });

  // Board-sized inputs where BOTH Math.hypot and sqrt(a*a + b*b) are off by an
  // ulp. These are the cases that used to reorder tied rows in a report.
  const AWKWARD: ReadonlyArray<readonly [number, number, number]> = [
    [288.10490849554924, -229.16053304702274, 368.1290374388095],
    [-208.80927920369714, -6.622139714516663, 208.91425948452186],
    [224.70791048068588, 178.72387271793963, 287.11647063847494],
    [-148.64534606575364, -91.56627236777908, 174.58471050563955],
    [-286.1425673728511, 270.5913437248213, 393.82387454486684],
    [16.954437025274842, -212.0384766605456, 212.71522869641646],
  ];

  for (const [a, b, expected] of AWKWARD) {
    it(`is exact where the built-ins are not: hypot(${a}, ${b})`, () => {
      assert.notEqual(Math.hypot(a, b), expected);
      assert.notEqual(Math.sqrt(a * a + b * b), expected);
      assert.equal(hypot(a, b), expected);
    });
  }
});
