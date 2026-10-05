// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import { Vector3 } from 'three';
import { Svg, G as SVGGroup } from '@svgdotjs/svg.js';
import { Viewmap } from '../../viewmap/Viewmap';
import { Chain, ChainVisibility } from '../../viewmap/Chain';
import { ViewEdge, ViewEdgeNature } from '../../viewmap/ViewEdge';
import { ViewVertex } from '../../viewmap/ViewVertex';
import { getSVGPath } from '../svgutils';
import { ChainPass, ChainPassOptions, StrokeStyle } from './ChainPass';
import { mergeOptions } from '../../../utils/objects';

export type BlendVisibilityFilter = 'visible' | 'hidden' | 'all';

export interface BlendTangentChainPassOptions extends ChainPassOptions {
  /**
   * Which chain visibilities to process.
   * @defaultValue 'visible'
   */
  visibilityFilter?: BlendVisibilityFilter;

  /**
   * Edge natures to consider for blend detection.
   * @defaultValue [Silhouette, Crease]
   */
  targetNatures?: ViewEdgeNature[];

  /**
   * Minimum curvature magnitude (radians per world-space unit) for an edge to
   * qualify. Edges below this are essentially flat and excluded.
   * @defaultValue 0.05
   */
  minCurvatureMagnitude?: number;

  /**
   * Minimum cos(angle) between consecutive curvature axes to continue a run.
   * Uses absolute value so sign of the cross-product does not matter.
   * 1 = perfectly aligned, 0 = orthogonal.
   * @defaultValue 0.85
   */
  axisAlignmentThreshold?: number;

  /**
   * Maximum absolute difference in anisotropy between consecutive edges in
   * the same run.
   * @defaultValue 0.2
   */
  anisotropyDeviationTolerance?: number;

  /**
   * Minimum anisotropy scalar to include an edge. Edges whose curvature axis
   * points equally toward all three world axes (isotropic in global frame) are
   * excluded. Set to 0 to disable the anisotropy filter entirely and rely only
   * on axis alignment.
   * @defaultValue 0.1
   */
  minAnisotropy?: number;

  /**
   * Minimum number of edges a sub-chain must contain before it is rendered.
   * Suppresses isolated single-edge detections.
   * @defaultValue 2
   */
  minSubChainLength?: number;

  /**
   * SVG group id written into the output.
   * @defaultValue 'blend-tangents'
   */
  groupId?: string;
}

interface EdgeSignature {
  /** Unit curvature axis in world space (axis around which the surface bends). */
  axis: Vector3;
  /** Bending per unit length (rad / world-unit). */
  magnitude: number;
  /**
   * How unequally the curvature axis projects onto world X/Y/Z.
   * max(|ax|,|ay|,|az|) - min(|ax|,|ay|,|az|) ∈ [0, 1].
   * 0 = perfectly diagonal (isotropic in global frame), 1 = aligned with one
   * world axis (e.g. a cylinder whose axis runs along world Y).
   */
  anisotropy: number;
}

const _nA = new Vector3();
const _nB = new Vector3();
const _axis = new Vector3();

function computeEdgeSignature(edge: ViewEdge): EdgeSignature | null {
  const he = edge.halfedge;
  if (!he || !he.face || !he.twin.face) return null;
  if (!isFinite(edge.faceAngle) || edge.faceAngle === 0) return null;

  const edgeLength = edge.a.pos3d.distanceTo(edge.b.pos3d);
  if (edgeLength < 1e-9) return null;

  he.face.getNormal(_nA);
  he.twin.face.getNormal(_nB);

  _axis.crossVectors(_nA, _nB);
  const axisLen = _axis.length();
  if (axisLen < 1e-9) return null;
  _axis.divideScalar(axisLen);

  const magnitude = (edge.faceAngle * Math.PI / 180) / edgeLength;

  const px = Math.abs(_axis.x);
  const py = Math.abs(_axis.y);
  const pz = Math.abs(_axis.z);
  const anisotropy = Math.max(px, py, pz) - Math.min(px, py, pz);

  return { axis: _axis.clone(), magnitude, anisotropy };
}

function groupToSubChains(
    chain: Chain,
    opts: Required<BlendTangentChainPassOptions>
): ViewVertex[][] {

  const sigs = chain.edges.map(computeEdgeSignature);
  const subChains: ViewVertex[][] = [];
  let current: ViewVertex[] | null = null;

  for (let i = 0; i < chain.edges.length; i++) {
    const sig = sigs[i];

    const qualifies =
      sig !== null &&
      sig.magnitude >= opts.minCurvatureMagnitude &&
      sig.anisotropy >= opts.minAnisotropy;

    let continues = false;
    if (qualifies && current !== null && i > 0) {
      const prevSig = sigs[i - 1];
      if (prevSig !== null) {
        // Abs dot product is sign-agnostic: cross-product axes may flip direction.
        const axisDot = Math.abs(sig.axis.dot(prevSig.axis));
        const anisoDiff = Math.abs(sig.anisotropy - prevSig.anisotropy);
        continues =
          axisDot >= opts.axisAlignmentThreshold &&
          anisoDiff < opts.anisotropyDeviationTolerance;
      }
    }

    if (qualifies && continues) {
      current!.push(chain.vertices[i + 1]);
    } else if (qualifies) {
      if (current !== null && current.length - 1 >= opts.minSubChainLength) {
        subChains.push(current);
      }
      current = [chain.vertices[i], chain.vertices[i + 1]];
    } else {
      if (current !== null && current.length - 1 >= opts.minSubChainLength) {
        subChains.push(current);
      }
      current = null;
    }
  }

  if (current !== null && current.length - 1 >= opts.minSubChainLength) {
    subChains.push(current);
  }

  return subChains;
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
  targetNatures: [ViewEdgeNature.Silhouette, ViewEdgeNature.Crease],
  minCurvatureMagnitude: 0.05,
  axisAlignmentThreshold: 0.85,
  anisotropyDeviationTolerance: 0.2,
  minAnisotropy: 0.1,
  minSubChainLength: 2,
  groupId: 'blend-tangents',
};

/**
 * Chain pass that detects tangential edges of blend/fillet surfaces by
 * grouping consecutive edges whose curvature axes (the world-space axis around
 * which the surface bends) are similar in direction and anisotropy.
 *
 * Edges on flat surfaces (low curvature magnitude) and on fully isotropic
 * surfaces (curvature axis pointing equally toward all world axes) are
 * filtered out, leaving the characteristic transition lines of oriented
 * blend/round features.
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
    const { visibilityFilter, targetNatures, styles, defaultStyle } = opts;

    const targetNatureSet = new Set(targetNatures);

    const chains = viewmap.chains.filter(c => {
      if (!targetNatureSet.has(c.nature)) return false;
      if (visibilityFilter === 'visible') return c.visibility === ChainVisibility.Visible;
      if (visibilityFilter === 'hidden')  return c.visibility === ChainVisibility.Hidden;
      return true;
    });

    const meshes = Array.from(viewmap.meshes).filter(m =>
      (visibilityFilter !== 'hidden'  && m.drawVisibleContours) ||
      (visibilityFilter !== 'visible' && m.drawHiddenContours)
    );

    const rootGroup = new SVGGroup({ id: opts.groupId });
    svg.add(rootGroup);

    for (const mesh of meshes) {
      const meshChains = chains.filter(c => c.object === mesh);
      if (meshChains.length === 0) continue;

      const meshGroup = new SVGGroup({ id: mesh.name });
      rootGroup.add(meshGroup);

      for (const chain of meshChains) {
        const natureStyle = styles[chain.nature];
        if (!natureStyle?.enabled) continue;

        const strokeStyle: StrokeStyle = { ...defaultStyle, ...natureStyle };

        const subChains = groupToSubChains(chain, opts);
        for (const vertices of subChains) {
          const style = opts.useRandomColors
            ? { ...strokeStyle, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') }
            : { ...strokeStyle };

          const path = getSVGPath(vertices, [], false, style);
          meshGroup.add(path);
        }
      }
    }
  }
}
