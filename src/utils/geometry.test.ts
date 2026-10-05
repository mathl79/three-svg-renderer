/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Mon Dec 05 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189 
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import { Line3, OrthographicCamera, Vector2, Vector3 } from "three";
import { cameraDepth, intersectLines, projectPoint } from "./geometry";

describe('intersectLines intersectLines', () => {

  const a = new Line3();
  const b = new Line3();
  const target = new Vector3();

  test ('Intersecting Lines in 2d', () => {

    a.start.set(1,1,0);
    a.end.set(1,3,0);

    b.start.set(0,1,0);
    b.end.set(2,1,0);

    expect(intersectLines(a, b, target)).toBeTruthy();
    expect(target.x).toBeCloseTo(1);
    expect(target.y).toBeCloseTo(1);
    expect(target.z).toBeCloseTo(0);

  });

  test ('Intersecting Lines in 3d', () => {

    a.start.set(0,0,0);
    a.end.set(2,2,2);

    b.start.set(2,0,0);
    b.end.set(0,2,2);

    expect(intersectLines(a, b, target)).toBeTruthy();
    expect(target.x).toBeCloseTo(1);
    expect(target.y).toBeCloseTo(1);
    expect(target.z).toBeCloseTo(1);
  });

  test ('Intersect on point', () => {

    a.start.set(0,0,0);
    a.end.set(1.345678912,2.456789123,3.5678912345);

    b.start.set(1.345678912,2.456789123,3.5678912345);
    b.end.set(9,9,9);

    expect(intersectLines(a, b, target)).toBeTruthy();
    expect(target.x).toBeCloseTo(1.345678912, 9);
    expect(target.y).toBeCloseTo(2.456789123, 9);
    expect(target.z).toBeCloseTo(3.567891234, 9);
  });

  test ('Intersect T shape', () => {

    a.start.set(1.456789,0,0);
    a.end.set(1.456789,2,0);

    b.start.set(1.456789,1,0);
    b.end.set(3,2,0);

    expect(intersectLines(a, b, target)).toBeTruthy();
    expect(target.x).toBeCloseTo(1.456789, 9);
    expect(target.y).toBeCloseTo(1);
    expect(target.z).toBeCloseTo(0);
  });

  test ('Non Intersecting Lines', () => {

    a.start.set(0,0,0);
    a.end.set(0,2,0);

    b.start.set(1,1,0);
    b.end.set(2,1,0);

    expect(intersectLines(a, b, target)).toBeFalsy();
  });

  test('Projects points with an orthographic camera', () => {
    const camera = new OrthographicCamera(-2, 2, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const imagePoint = projectPoint(
      new Vector3(1, 0, 0), new Vector2(), camera, {w: 400, h: 200}
    );

    expect(imagePoint.x).toBeCloseTo(300);
    expect(imagePoint.y).toBeCloseTo(100);
    expect(cameraDepth(new Vector3(0, 0, -1), camera))
      .toBeGreaterThan(cameraDepth(new Vector3(0, 0, 0), camera));
  });

});