import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { child, children, numberAt, parseSexpr, vec2 } from '../lib/sexpr.ts';
import { isList } from '../lib/sexpr.ts';

const parseOne = (text: string) => {
  const [root] = parseSexpr(text);
  assert.ok(isList(root));
  return root;
};

describe('parseSexpr', () => {
  it('nests lists', () => {
    assert.deepEqual(parseSexpr('(a (b c) d)'), [['a', ['b', 'c'], 'd']]);
  });

  it('keeps quoted atoms whole, spaces and parens included', () => {
    assert.deepEqual(parseOne('(property "Reference" "D 12 (x)")'), ['property', 'Reference', 'D 12 (x)']);
  });

  it('treats an empty list as empty', () => {
    assert.deepEqual(parseSexpr('()'), [[]]);
  });

  it('rejects an unbalanced closing paren', () => {
    assert.throws(() => parseSexpr('(a))'), /unbalanced/);
  });
});

describe('accessors', () => {
  const pad = parseOne('(pad "1" smd roundrect (at 1.5 -2.5 90) (size 0.9 1.2) (layers "F.Cu" "F.Mask"))');

  it('finds children by head', () => {
    assert.equal(children(pad, 'size').length, 1);
    assert.equal(child(pad, 'missing'), undefined);
  });

  it('reads coordinate pairs', () => {
    assert.deepEqual(vec2(child(pad, 'at')), [1.5, -2.5]);
  });

  it('reads an optional trailing rotation', () => {
    assert.equal(numberAt(child(pad, 'at'), 3), 90);
    assert.equal(numberAt(child(pad, 'size'), 3), undefined);
  });

  it('refuses a missing coordinate node rather than yielding NaN', () => {
    assert.throws(() => vec2(child(pad, 'missing')), /two coordinates/);
  });
});
