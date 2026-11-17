import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bounds, countOutside, flatten, gap, isInside, rectOutline, samplePoints, segmentDistance, sweepOf, type Outline } from '../lib/outline.ts';

const square = (size: number): Outline => rectOutline([0, 0], [size, size], 0);

describe('flatten', () => {
  it('accumulates nested origins', () => {
    const segments = flatten({
      origin: [1, 1],
      models: {
        inner: {
          origin: [10, 0],
          paths: { edge: { type: 'line', origin: [0, 0], end: [5, 0] } },
        },
      },
    });
    assert.deepEqual(segments, [{ kind: 'line', from: [11, 1], to: [16, 1] }]);
  });

  it('emits a level own paths before its child models', () => {
    const segments = flatten({
      paths: { mine: { type: 'circle', radius: 1 } },
      models: { child: { paths: { theirs: { type: 'circle', radius: 2 } } } },
    });
    assert.deepEqual(segments.map((s) => (s.kind === 'circle' ? s.radius : 0)), [1, 2]);
  });

  it('skips an empty branch, which YAML gives us as null', () => {
    assert.deepEqual(flatten({ models: { gone: null as never } }), []);
  });
});

describe('samplePoints', () => {
  it('counts differ per kind: lines and arcs include both ends, circles do not close', () => {
    assert.equal(samplePoints([{ kind: 'line', from: [0, 0], to: [1, 0] }], 10).length, 11);
    assert.equal(samplePoints([{ kind: 'circle', centre: [0, 0], radius: 1 }], 10).length, 10);
    assert.equal(samplePoints([{ kind: 'arc', centre: [0, 0], radius: 1, start: 0, end: 90 }], 10).length, 11);
  });
});

describe('sweepOf', () => {
  it('treats coincident angles as a full turn', () => {
    assert.equal(sweepOf({ kind: 'arc', centre: [0, 0], radius: 1, start: 30, end: 30 }), 360);
  });

  it('normalises backwards arcs', () => {
    assert.equal(sweepOf({ kind: 'arc', centre: [0, 0], radius: 1, start: 350, end: 10 }), 20);
  });
});

describe('isInside', () => {
  it('accepts the interior and rejects the exterior', () => {
    assert.equal(isInside(square(10), [0, 0]), true);
    assert.equal(isInside(square(10), [9, 0]), false);
  });

  it('ignores circles entirely — only straight segments vote', () => {
    const disc: Outline = [{ kind: 'circle', centre: [0, 0], radius: 10 }];
    assert.equal(isInside(disc, [0, 0]), false);
  });
});

describe('segmentDistance', () => {
  it('measures a line as a segment, not an infinite line', () => {
    assert.equal(segmentDistance([5, 0], { kind: 'line', from: [0, 0], to: [1, 0] }), 4);
  });

  it('measures a curve against its full circle, arc range included', () => {
    const arc = { kind: 'arc', centre: [0, 0], radius: 2, start: 0, end: 90 } as const;
    // (0, -5) is nowhere near the 0..90 arc, yet the distance is to the circle.
    assert.equal(segmentDistance([0, -5], arc), 3);
  });
});

describe('gap', () => {
  it('finds the closest approach and is not symmetric in cost, only in value here', () => {
    const near = rectOutline([12, 0], [2, 2], 0);
    assert.ok(Math.abs(gap(square(10), near) - 6) < 1e-9);
  });
});

describe('countOutside', () => {
  it('is zero when the inner shape really is inside', () => {
    assert.equal(countOutside(square(4), square(10)), 0);
  });

  it('counts the points that escape', () => {
    assert.ok(countOutside(square(20), square(10)) > 0);
  });
});

describe('bounds', () => {
  it('includes a circle full extent, not just its centre', () => {
    assert.deepEqual(bounds([{ kind: 'circle', centre: [5, 5], radius: 2 }]), { minX: 3, minY: 3, maxX: 7, maxY: 7 });
  });
});

describe('rectOutline', () => {
  const corners = (outline: Outline) => outline.map((segment) => (segment.kind === 'line' ? segment.from : null));

  it('closes into four line segments', () => {
    const rect = rectOutline([0, 0], [4, 2], 0);
    assert.equal(rect.length, 4);
    assert.deepEqual(corners(rect), [
      [-2, -1],
      [2, -1],
      [2, 1],
      [-2, 1],
    ]);
  });

  it('rotates counter-clockwise, in ergogen y-up frame', () => {
    const [first] = corners(rectOutline([0, 0], [2, 0], 90));
    assert.ok(first && Math.abs(first[0]) < 1e-9 && Math.abs(first[1] + 1) < 1e-9, `got ${first}`);
  });
});
