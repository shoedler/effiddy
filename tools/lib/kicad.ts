import { readFileSync } from 'node:fs';
import {
  boundsOf,
  distance,
  polygonEdges,
  rectCorners,
  regularPolygon,
  rotateKicad,
  toRadians,
  translate,
  type BBox,
  type Edge,
  type Polygon,
  type Vec2,
} from './geom.ts';
import { asNumber, child, children, isList, numberAt, parseSexpr, vec2, type SNode } from './sexpr.ts';

export interface Pad {
  /** The footprint's reference designator, e.g. `D12`. */
  readonly ref: string;
  readonly number: string;
  readonly type: string;
  readonly shape: string;
  readonly pos: Vec2;
  readonly size: Vec2;
  readonly angle: number;
  /** Null for an undrilled SMD pad, and for the oval drills we do not model. */
  readonly drill: number | null;
  readonly net: string;
  readonly layers: readonly string[];
  readonly poly: Polygon;
}

export interface Zone {
  readonly name: string;
  readonly keepout: boolean;
  readonly net: string;
  readonly points: Polygon;
}

export interface Board {
  readonly pads: readonly Pad[];
  readonly edges: readonly Edge[];
  readonly zones: readonly Zone[];
  readonly bounds: BBox;
  /** Bounding box of every pad of the footprints whose library id contains `libraryIdPart`. */
  footprintBBox(libraryIdPart: string): BBox | null;
}

export function readBoard(path: string): Board {
  const [root] = parseSexpr(readFileSync(path, 'utf8'));
  if (!isList(root)) throw new Error(`${path} is not a KiCad board file`);

  const edges = readEdges(root);
  const bounds = boundsOf(edges.flat());
  if (!bounds) throw new Error(`${path} has no Edge.Cuts geometry`);

  return {
    pads: readPads(root),
    edges,
    zones: readZones(root),
    bounds,
    footprintBBox: (libraryIdPart) => footprintBBox(root, libraryIdPart),
  };
}

/** Outline of a pad as a point list; circles are approximated by a 24-gon. */
export function padPolygon(pos: Vec2, size: Vec2, angle: number, shape: string, roundRatio = 0): Polygon {
  const [width, height] = size;

  if (shape === 'roundrect' && roundRatio) {
    const r = Math.min(width, height) * roundRatio;
    const corners: ReadonlyArray<readonly [Vec2, number]> = [
      [[width / 2 - r, height / 2 - r], 0],
      [[-(width / 2 - r), height / 2 - r], 90],
      [[-(width / 2 - r), -(height / 2 - r)], 180],
      [[width / 2 - r, -(height / 2 - r)], 270],
    ];
    return corners.flatMap(([[cx, cy], from]) =>
      Array.from({ length: 5 }, (_, k): Vec2 => {
        const a = toRadians(from + (90 * k) / 4);
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      }).map((local) => translate(pos, rotateKicad(local, angle))),
    );
  }

  // A round pad looks the same from every angle, so this branch ignores it.
  if ((shape === 'circle' || shape === 'oval') && Math.abs(width - height) < 1e-9) {
    return regularPolygon(pos, width / 2, 24);
  }

  return rectCorners(size).map((corner) => translate(pos, rotateKicad(corner, angle)));
}

function readPads(root: SNode[]): Pad[] {
  const pads: Pad[] = [];
  for (const footprint of children(root, 'footprint')) {
    const at = child(footprint, 'at');
    const origin = vec2(at);
    const rotation = numberAt(at, 3) ?? 0;
    const ref = referenceOf(footprint);

    for (const pad of children(footprint, 'pad')) {
      const padAt = child(pad, 'at');
      // A pad without its own angle inherits the footprint's, not zero.
      const angle = numberAt(padAt, 3) ?? rotation;
      const pos = translate(origin, rotateKicad(vec2(padAt), rotation));
      const size = vec2(child(pad, 'size'));
      const shape = String(pad[3]);
      const net = child(pad, 'net');
      const layers = child(pad, 'layers') ?? [];

      pads.push({
        ref,
        number: String(pad[1]),
        type: String(pad[2]),
        shape,
        pos,
        size,
        angle,
        drill: drillDiameter(child(pad, 'drill')),
        net: net && net.length > 2 ? String(net[2]) : '',
        layers: layers.slice(1).filter((layer): layer is string => typeof layer === 'string'),
        poly: padPolygon(pos, size, angle, shape, roundRatio(pad)),
      });
    }
  }
  return pads;
}

function readEdges(root: SNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const node of root) {
    if (!isList(node) || child(node, 'layer')?.[1] !== 'Edge.Cuts') continue;

    if (node[0] === 'gr_line') {
      edges.push([vec2(child(node, 'start')), vec2(child(node, 'end'))]);
    } else if (node[0] === 'gr_poly') {
      const points = children(child(node, 'pts') ?? [], 'xy').map(vec2);
      edges.push(...polygonEdges(points));
    } else if (node[0] === 'gr_circle') {
      const centre = vec2(child(node, 'center'));
      const rim = vec2(child(node, 'end'));
      edges.push(...polygonEdges(regularPolygon(centre, distance(centre, rim), 48)));
    }
  }
  return edges;
}

function readZones(root: SNode[]): Zone[] {
  const zones: Zone[] = [];
  for (const scope of [root, ...children(root, 'footprint')]) {
    for (const zone of children(scope, 'zone')) {
      const polygon = child(zone, 'polygon');
      if (!polygon) continue;
      zones.push({
        name: String(child(zone, 'name')?.[1] ?? ''),
        keepout: child(zone, 'keepout') !== undefined,
        net: String(child(zone, 'net_name')?.[1] ?? ''),
        points: children(child(polygon, 'pts') ?? [], 'xy').map(vec2),
      });
    }
  }
  return zones;
}

function footprintBBox(root: SNode[], libraryIdPart: string): BBox | null {
  const extremes: Vec2[] = [];
  for (const footprint of children(root, 'footprint')) {
    if (!String(footprint[1]).includes(libraryIdPart)) continue;
    const at = child(footprint, 'at');
    const origin = vec2(at);
    const rotation = numberAt(at, 3) ?? 0;
    for (const pad of children(footprint, 'pad')) {
      const [x, y] = translate(origin, rotateKicad(vec2(child(pad, 'at')), rotation));
      const reach = Math.max(...vec2(child(pad, 'size'))) / 2;
      extremes.push([x - reach, y - reach], [x + reach, y + reach]);
    }
  }
  return boundsOf(extremes);
}

/** True when two pads share a copper layer; `*.Cu` means both sides. */
export function sharesCopperLayer(a: readonly string[], b: readonly string[]): boolean {
  const expand = (layers: readonly string[]) =>
    new Set(layers.flatMap((layer) => (layer.startsWith('*.') ? [`F.${layer.slice(2)}`, `B.${layer.slice(2)}`] : [layer])));
  const [onA, onB] = [expand(a), expand(b)];
  return ['F.Cu', 'B.Cu'].some((layer) => onA.has(layer) && onB.has(layer));
}

function referenceOf(footprint: SNode[]): string {
  let ref = 'FP';
  for (const property of children(footprint, 'property')) {
    if (property.length > 2 && property[1] === 'Reference') ref = String(property[2]);
  }
  return ref;
}

function drillDiameter(drill: SNode[] | undefined): number | null {
  const raw = drill?.[1];
  // `(drill oval 1 2)` has no single diameter; nothing here needs one.
  return typeof raw === 'string' && /^[\d.]+$/.test(raw) ? Number(raw) : null;
}

function roundRatio(pad: SNode[]): number {
  const node = child(pad, 'roundrect_rratio');
  return node ? asNumber(node[1]) : 0;
}
