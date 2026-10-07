import * as fs from 'fs';
import * as path from 'path';
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4 } from 'three';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore jest resolves the UMD entry which lacks ESM named exports
import { HalfedgeDS } from 'three-mesh-halfedge/build/index.esm.js';
import { detectBlendEdges, linkBlendEdges } from './BlendTangentChainPass';

const OPTIONS = {
  sharpAngle: 40,
  coplanarAngle: 0.5,
  curvatureJump: 0.45,
  minRelativeCurvature: 2,
};

function loadOBJ(file: string) {
  const positions = new Array<number[]>();
  const triangles = new Array<number>();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') {
      positions.push(p.slice(1, 4).map(Number));
    } else if (p[0] === 'f') {
      const idx = p.slice(1).map(s => parseInt(s) - 1);
      for (let i = 1; i + 1 < idx.length; i++) {
        triangles.push(...positions[idx[0]], ...positions[idx[i]], ...positions[idx[i+1]]);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(triangles, 3));
  return geometry;
}

function detectChains(matrix?: Matrix4) {
  const geometry = loadOBJ(path.resolve('examples/ringcore.obj'));
  if (matrix) geometry.applyMatrix4(matrix);
  const hes = new HalfedgeDS();
  hes.setFromGeometry(geometry, 1e-5);
  const edges = detectBlendEdges({hes}, OPTIONS);
  return linkBlendEdges(edges, 0.7).filter(c => c.edges.length >= 3);
}

test('ringcore blend lines form closed loops', () => {
  const chains = detectChains();
  const loops = chains.filter(c => c.closed && c.edges.length >= 30);
  // Inner/outer fillet tangent lines at top and bottom of the ring
  expect(loops.length).toBeGreaterThanOrEqual(8);
});

test('blend detection does not depend on orientation', () => {
  const lengths = (m?: Matrix4) =>
    detectChains(m).map(c => c.edges.length).sort((a, b) => a - b);
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(0.7, 1.1, -0.4))
    .setPosition(3, -5, 2);
  const reference = lengths();
  const rotated = lengths(rotation);
  const longLoops = (l: number[]) => l.filter(n => n >= 30);
  expect(longLoops(rotated)).toEqual(longLoops(reference));
});
