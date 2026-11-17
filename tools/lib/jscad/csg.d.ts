/**
 * `@jscad/csg` ships no types. This declares only the slice of the CSG v1 API
 * that ergogen's generated `.jscad` files and this toolchain actually use.
 */
declare module '@jscad/csg' {
  export interface Vertex {
    readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  }

  export interface Polygon {
    readonly vertices: readonly Vertex[];
  }

  export interface Solid {
    toPolygons(): Polygon[];
    getBounds(): [Vertex['pos'], Vertex['pos']];
    union(other: Solid): Solid;
    subtract(other: Solid): Solid;
    intersect(other: Solid): Solid;
    translate(offset: readonly number[]): Solid;
    rotate(centre: readonly number[], axis: readonly number[], degrees: number): Solid;
    scale(factor: readonly number[]): Solid;
  }

  /** The package is CommonJS, so its exports arrive as one default object. */
  interface Api {
    readonly CSG: unknown;
    readonly CAG: unknown;
  }

  const api: Api;
  export default api;
}
