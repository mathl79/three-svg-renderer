/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Wed Dec 14 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189 
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

export function mergeOptions<T extends object>(target: T, source: Partial<T>): T {
  // Iterate through `source` properties and if an `Object` set property to merge of `target` and `source` properties
  const targetValues = target as Record<string, unknown>;
  const sourceValues = source as Record<string, unknown>;
  for (const key of Object.keys(sourceValues)) {
    const sourceValue = sourceValues[key];
    const targetValue = targetValues[key];
    if (isObject(targetValue) && isObject(sourceValue)) {
      Object.assign(sourceValue, mergeOptions(targetValue, sourceValue));
    }
  }

  // Join `target` and modified `source`
  return Object.assign(target, source);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}