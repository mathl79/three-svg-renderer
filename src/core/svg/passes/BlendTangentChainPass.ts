// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {
  Camera, DoubleSide, Material, OrthographicCamera, Raycaster, Side, Vector2, Vector3
} from 'three';
import { Svg, G as SVGGroup } from '@svgdotjs/svg.js';
import { Face, Halfedge, Vertex } from 'three-mesh-halfedge';
import { Viewmap } from '../../viewmap/Viewmap';
import { ViewEdgeNature } from '../../viewmap/ViewEdge';
import { SVGMesh } from '../../SVGMesh';
import { getSVGPath } from '../svgutils';
import { ChainPass, ChainPassOptions } from './ChainPass';
import { mergeOptions } from '../../../utils/objects';
import { projectPoint } from '../../../utils';

export type BlendVisibilityFilter = 'visible' | 'hidden' | 'all';

export interface BlendTangentChainPassOptions extends ChainPassOptions {
  /**
   * Which blend line visibilities to draw.
   * @defaultValue 'visible'
   */
  visibilityFilter?: BlendVisibilityFilter;

  /**
   * Dihedral angle (degrees) above which an edge is a sharp feature edge.
   * Sharp edges are neither blend candidates nor used in curvature estimation,
   * so curvature never leaks across real creases. Must be larger than the
   * chord step of the coarsest fillet tessellation.
   * @defaultValue 40
   */
  sharpAngle?: number;

  /**
   * Dihedral angle (degrees) below which adjacent faces are merged into one
   * planar facet before curvature estimation (e.g. the two triangles of a
   * tessellation quad).
   * @defaultValue 0.5
   */
  coplanarAngle?: number;

  /**
   * Minimum cosine between consecutive edge directions when linking blend
   * edges into chains at junction vertices (straightest continuation wins).
   * @defaultValue 0.7
   */
  continuationCos?: number;

  /**
   * Minimum relative curvature jump across an edge for it to be a blend
   * transition line: `|T_A - T_B| / max(|T_A|, |T_B|)` where `T` are the
   * per-face discrete curvature tensors. 0 = any change, 1 = one side flat.
   * Captures radius changes (plane→fillet, cylinder→fillet) as well as
   * curvature axis changes (cylinder→torus, cylinder→sphere).
   * @defaultValue 0.45
   */
  curvatureJump?: number;

  /**
   * Minimum curvature of the more curved side, relative to the mesh size
   * (curvature × bounding box diagonal). Suppresses transitions between
   * nearly flat regions caused by tessellation noise.
   * Value 2 ≈ radius smaller than half the bounding box diagonal.
   * @defaultValue 2
   */
  minRelativeCurvature?: number;

  /**
   * Minimum number of mesh edges a blend chain must contain.
   * @defaultValue 3
   */
  minChainLength?: number;

  /**
   * SVG group id written into the output.
   * @defaultValue 'blend-tangents'
   */
  groupId?: string;
}

/** Symmetric 3x3 tensor stored as [xx, yy, zz, xy, xz, yz] */
type Tensor = Float64Array;

export interface BlendEdge {
  he: Halfedge;
  /** Relative curvature jump across the edge */
  score: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();
const _nA = new Vector3();
const _nB = new Vector3();
const _d = new Vector3();

function tensorNorm(t: Tensor, o = 0, u?: Tensor, uo = 0) {
  let s = 0;
  for (let i = 0; i < 6; i++) {
    const x = u ? t[o + i] - u[uo + i] : t[o + i];
    // Off-diagonal terms count twice in the Frobenius norm
    s += (i < 3 ? 1 : 2) * x * x;
  }
  return Math.sqrt(s);
}

/**
 * Signed dihedral angle (radians) of the edge carried by `he`, positive for
 * convex edges. Returns NaN for boundary edges.
 */
function signedDihedral(he: Halfedge): number {
  if (!he.face || !he.twin.face) return NaN;
  he.face.getNormal(_nA);
  he.twin.face.getNormal(_nB);
  const angle = Math.acos(Math.max(-1, Math.min(1, _nA.dot(_nB))));
  _d.subVectors(he.next.vertex.position, he.vertex.position);
  return _n.crossVectors(_nA, _nB).dot(_d) >= 0 ? angle : -angle;
}

/**
 * Detects blend transition edges of a mesh by searching curvature
 * discontinuities across tangent-continuous edges.
 *
 * Each face receives the discrete curvature tensor of Cohen-Steiner & Morvan
 * restricted to the face: `T_f = 1/A_f Σ_e ½ β_e |e| ê êᵀ` over its smooth
 * edges (β_e signed dihedral). The tensor is orientation independent and
 * encodes both magnitude and axis of the bending, so planes (T=0), cylinders
 * (rank 1), tori and spheres (rank 2) are distinguished implicitly without
 * explicit primitive fitting. On chord tessellated CAD surfaces the dihedral
 * at a fillet boundary is only half a fillet step, while inside the fillet it
 * is a full step, so the tensor jumps across the tangent line and stays
 * constant inside a primitive.
 *
 * An edge is a blend edge when it is smooth (β < sharpAngle) and the tensors
 * of its two faces differ by more than `curvatureJump`. The edge's own
 * contribution is shared by both faces, so a lone tessellation fold inside a
 * flat region produces no jump.
 */
export function detectBlendEdges(
    mesh: Pick<SVGMesh, 'hes'>,
    options: Pick<Required<BlendTangentChainPassOptions>,
      'sharpAngle' | 'coplanarAngle' | 'curvatureJump' | 'minRelativeCurvature'>
): BlendEdge[] {

  const {faces, halfedges, vertices} = mesh.hes;
  const sharp = options.sharpAngle * Math.PI / 180;

  const coplanar = options.coplanarAngle * Math.PI / 180;

  const faceIndex = new Map<Face, number>();
  faces.forEach((f, i) => faceIndex.set(f, i));

  // Union-find of coplanar faces: triangulated quads and planar n-gons
  // become one patch, so a tensor describes a whole facet of the
  // tessellation instead of a single (arbitrarily split) triangle.
  const parent = new Int32Array(faces.length).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const edges = new Array<{he: Halfedge, beta: number}>();
  const handled = new Set<Halfedge>();
  for (const he of halfedges) {
    if (handled.has(he.twin)) continue;
    handled.add(he);
    const beta = signedDihedral(he);
    if (!isFinite(beta)) continue;
    edges.push({he, beta});
    if (Math.abs(beta) < coplanar) {
      const fa = find(faceIndex.get(he.face as Face) as number);
      const fb = find(faceIndex.get(he.twin.face as Face) as number);
      parent[fa] = fb;
    }
  }

  const patch = (face: Face | null) => find(faceIndex.get(face as Face) as number);

  const areas = new Float64Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const he = faces[i].halfedge;
    _a.copy(he.prev.vertex.position);
    _b.subVectors(he.vertex.position, _a);
    _c.subVectors(he.next.vertex.position, _a);
    areas[find(i)] += 0.5 * _n.crossVectors(_b, _c).length();
  }

  const tensors = new Float64Array(faces.length * 6);
  const smoothEdges = new Array<Halfedge>();

  for (const {he, beta} of edges) {
    if (Math.abs(beta) >= sharp) continue;
    const pa = patch(he.face);
    const pb = patch(he.twin.face);
    if (pa === pb) continue;
    smoothEdges.push(he);

    _d.subVectors(he.next.vertex.position, he.vertex.position);
    const len = _d.length();
    if (len < 1e-12) continue;
    _d.divideScalar(len);

    const w = 0.5 * beta * len;
    const contrib = [_d.x*_d.x, _d.y*_d.y, _d.z*_d.z, _d.x*_d.y, _d.x*_d.z, _d.y*_d.z];

    for (const pi of [pa, pb]) {
      const area = areas[pi];
      if (area < 1e-16) continue;
      for (let k = 0; k < 6; k++) {
        tensors[pi * 6 + k] += w * contrib[k] / area;
      }
    }
  }

  // Mesh scale for the relative curvature threshold
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const v of vertices) {
    min.min(v.position);
    max.max(v.position);
  }
  const diagonal = Math.max(min.distanceTo(max), 1e-12);
  const minCurvature = options.minRelativeCurvature / diagonal;

  const blendEdges = new Array<BlendEdge>();
  for (const he of smoothEdges) {
    const fa = patch(he.face);
    const fb = patch(he.twin.face);
    const na = tensorNorm(tensors, fa * 6);
    const nb = tensorNorm(tensors, fb * 6);
    const nmax = Math.max(na, nb);
    if (nmax < minCurvature) continue;
    const jump = tensorNorm(tensors, fa * 6, tensors, fb * 6) / nmax;
    if (jump >= options.curvatureJump) {
      blendEdges.push({he, score: jump});
    }
  }

  return blendEdges;
}

interface BlendChain {
  vertices: Vertex[];
  edges: Halfedge[];
  closed: boolean;
}

/**
 * Links blend edges into polylines. At vertices joining more than two blend
 * edges, the walk continues along the straightest edge (cosine above
 * `minCos`) so that crossing tangent lines stay separate chains. Walks start
 * at end points, then at the highest scored remaining edges (closed loops).
 */
export function linkBlendEdges(edges: BlendEdge[], minCos: number): BlendChain[] {
  const adjacency = new Map<Vertex, Halfedge[]>();
  const add = (v: Vertex, he: Halfedge) => {
    let list = adjacency.get(v);
    if (!list) adjacency.set(v, list = []);
    list.push(he);
  };
  for (const {he} of edges) {
    add(he.vertex, he);
    add(he.twin.vertex, he);
  }

  const used = new Set<Halfedge>();
  const chains = new Array<BlendChain>();
  const other = (he: Halfedge, v: Vertex) =>
    he.vertex === v ? he.twin.vertex : he.vertex;
  const direction = (he: Halfedge, from: Vertex, target: Vector3) =>
    target.subVectors(other(he, from).position, from.position).normalize();

  const _in = new Vector3();
  const _out = new Vector3();

  const walk = (start: Vertex, first: Halfedge) => {
    const chain: BlendChain = {vertices: [start], edges: [], closed: false};
    let v = start;
    let he: Halfedge | undefined = first;
    while (he && !used.has(he)) {
      used.add(he);
      chain.edges.push(he);
      direction(he, v, _in);
      v = other(he, v);
      chain.vertices.push(v);
      if (v === start) {
        chain.closed = true;
        break;
      }
      let best: Halfedge | undefined;
      let bestCos = minCos;
      for (const next of adjacency.get(v) as Halfedge[]) {
        if (used.has(next)) continue;
        const cos = _in.dot(direction(next, v, _out));
        if (cos > bestCos) {
          bestCos = cos;
          best = next;
        }
      }
      he = best;
    }
    chains.push(chain);
  };

  for (const [v, list] of adjacency) {
    if (list.length === 1 && !used.has(list[0])) walk(v, list[0]);
  }
  const remaining = edges.filter(e => !used.has(e.he))
    .sort((e1, e2) => e2.score - e1.score);
  for (const {he} of remaining) {
    if (!used.has(he)) walk(he.vertex, he);
  }

  return chains;
}

const _raycaster = new Raycaster();
const _origin = new Vector3();
const _dir = new Vector3();
const _faceNormal = new Vector3();

function isFrontFace(face: Face, camera: Camera) {
  face.getNormal(_faceNormal);
  if (camera instanceof OrthographicCamera) {
    camera.getWorldDirection(_dir);
    return _faceNormal.dot(_dir) <= 0;
  }
  return face.isFront(camera.position);
}

function isEdgeVisible(
    he: Halfedge,
    viewmap: Viewmap,
    epsilon: number): boolean {

  const camera = viewmap.camera;
  const frontA = he.face ? isFrontFace(he.face, camera) : false;
  const frontB = he.twin.face ? isFrontFace(he.twin.face, camera) : false;
  if (!frontA && !frontB) return false;

  _origin.lerpVectors(he.vertex.position, he.twin.vertex.position, 0.5);
  if (camera instanceof OrthographicCamera) {
    camera.getWorldDirection(_dir).negate();
  } else {
    _dir.subVectors(camera.position, _origin).normalize();
  }
  // Start slightly off the surface towards the camera to skip own faces
  _origin.addScaledVector(_dir, epsilon);
  _raycaster.set(_origin, _dir);
  _raycaster.firstHitOnly = true;

  const hits = _raycaster.intersectObjects(
    viewmap.meshes.map(m => m.threeMesh), false);
  return !hits.some(h => h.distance > epsilon);
}

function setDoubleSide(meshes: SVGMesh[]) {
  const sides = new Map<Material, Side>();
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      sides.set(material, material.side);
      material.side = DoubleSide;
    }
  }
  return () => sides.forEach((side, material) => material.side = side);
}

const DEFAULT_BLEND_OPTIONS: Required<BlendTangentChainPassOptions> = {
  // ChainPass defaults (duplicated here so mergeOptions has a base)
  useRandomColors: false,
  drawRaycastPoint: false,
  drawLegend: false,
  defaultStyle: {
    color: '#0055ff',
    width: 1,
    dasharray: '',
    linecap: 'round',
    linejoin: 'round',
    opacity: 1,
    dashoffset: 0,
  },
  styles: {
    [ViewEdgeNature.Silhouette]:       { enabled: true,  drawOrder: 5 },
    [ViewEdgeNature.Boundary]:         { enabled: false, drawOrder: 4 },
    [ViewEdgeNature.MeshIntersection]: { enabled: false, drawOrder: 3 },
    [ViewEdgeNature.Crease]:           { enabled: true,  drawOrder: 2 },
    [ViewEdgeNature.Material]:         { enabled: false, drawOrder: 1 },
  },
  // BlendTangentChainPass-specific defaults
  visibilityFilter: 'visible',
  sharpAngle: 40,
  coplanarAngle: 0.5,
  continuationCos: 0.7,
  curvatureJump: 0.45,
  minRelativeCurvature: 2,
  minChainLength: 3,
  groupId: 'blend-tangents',
};

/**
 * Draw pass rendering the tangent transition lines of blend/fillet surfaces
 * (edges where the surface stays tangent continuous but its curvature jumps,
 * e.g. plane→fillet, cylinder→torus).
 *
 * Detection runs directly on the mesh halfedge structure, so it neither
 * depends on the mesh orientation nor on the viewmap crease angle settings.
 * Visibility is computed per edge with raycasting.
 */
export class BlendTangentChainPass extends ChainPass {

  readonly blendOptions: Required<BlendTangentChainPassOptions>;

  constructor(options: BlendTangentChainPassOptions = {}) {
    super(options);

    this.blendOptions = { ...DEFAULT_BLEND_OPTIONS };
    mergeOptions(this.blendOptions, options);
  }

  async draw(svg: Svg, viewmap: Viewmap): Promise<void> {
    const opts = this.blendOptions;
    const { visibilityFilter, defaultStyle } = opts;

    const meshes = viewmap.meshes.filter(m =>
      (visibilityFilter !== 'hidden'  && m.drawVisibleContours) ||
      (visibilityFilter !== 'visible' && m.drawHiddenContours)
    );

    const rootGroup = new SVGGroup({ id: opts.groupId });
    svg.add(rootGroup);

    const restoreSides = setDoubleSide(viewmap.meshes);

    try {
      for (const mesh of meshes) {
        const blendEdges = detectBlendEdges(mesh, opts);
        const chains = linkBlendEdges(blendEdges, opts.continuationCos)
          .filter(c => c.edges.length >= opts.minChainLength);
        if (chains.length === 0) continue;

        const meshGroup = new SVGGroup({ id: mesh.name });
        rootGroup.add(meshGroup);

        mesh.threeMesh.geometry.computeBoundingSphere();
        const radius = mesh.threeMesh.geometry.boundingSphere?.radius ?? 1;
        const epsilon = 1e-4 * radius * mesh.matrixWorld.getMaxScaleOnAxis();

        for (const chain of chains) {
          for (const run of this.splitByVisibility(chain, viewmap, epsilon)) {
            const points = run.vertices.map(v => projectPoint(
              v.position, new Vector2(), viewmap.camera, viewmap.renderSize));

            const style = opts.useRandomColors
              ? { ...defaultStyle, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }
              : { ...defaultStyle };

            meshGroup.add(getSVGPath(points, [], run.closed, style));
          }
        }
      }
    } finally {
      restoreSides();
    }
  }

  /**
   * Splits a chain into runs of edges matching the visibility filter.
   */
  private splitByVisibility(
      chain: BlendChain,
      viewmap: Viewmap,
      epsilon: number): BlendChain[] {

    const filter = this.blendOptions.visibilityFilter;
    const keep = chain.edges.map(he => {
      if (filter === 'all' || viewmap.options.ignoreVisibility) return true;
      const visible = isEdgeVisible(he, viewmap, epsilon);
      return filter === 'visible' ? visible : !visible;
    });

    if (keep.every(k => k)) return [chain];

    // Rotate closed loops so that runs are not cut at the loop seam
    let offset = 0;
    const n = chain.edges.length;
    if (chain.closed) {
      offset = keep.indexOf(false) + 1;
    }

    const runs = new Array<BlendChain>();
    let current: BlendChain | null = null;
    for (let k = 0; k < n; k++) {
      const i = (k + offset) % n;
      if (keep[i]) {
        if (!current) {
          current = {vertices: [chain.vertices[i]], edges: [], closed: false};
        }
        current.edges.push(chain.edges[i]);
        current.vertices.push(chain.vertices[i + 1]);
      } else if (current) {
        runs.push(current);
        current = null;
      }
    }
    if (current) runs.push(current);
    return runs;
  }
}
