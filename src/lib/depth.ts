import type { Landmark, Metrics } from '../types';

const degrees = (radians: number) => radians * 180 / Math.PI;
const visible = (point?: Landmark) => !!point && (point.visibility ?? 1) >= .65;

/** Visual estimates only. World pose coordinates are model estimates in meters,
 * relative to the hips; they are not camera distance or measured anatomy. */
export function depthMetrics(face: Landmark[], pose: Landmark[], world: Landmark[], matrix: number[] | undefined, blendshapes: Record<string, number>, width: number, height: number): Partial<Metrics> {
  const metrics: Partial<Metrics> = {};
  const aspect = width / height;
  const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  if (matrix?.length === 16) {
    // MediaPipe MatrixData uses column-major storage. Normalize scale before
    // extracting XYZ Euler angles; translation is deliberately not used as range.
    const sx = Math.hypot(matrix[0], matrix[1], matrix[2]);
    metrics.headYaw = degrees(Math.asin(Math.max(-1, Math.min(1, -matrix[2] / sx))));
    metrics.headPitch = degrees(Math.atan2(matrix[6], matrix[10]));
  }
  if (face.length >= 478) {
    const mouthWidth = distance(face[61], face[291]);
    metrics.lipWidth = mouthWidth / Math.max(distance(face[33], face[263]), .001);
    metrics.jawAsymmetry = Math.abs(distance(face[61], face[152]) - distance(face[291], face[152])) / Math.max(mouthWidth, .001);
    const depths = face.slice(0, 468).map(point => point.z ?? 0);
    metrics.faceDepthSpan = Math.max(...depths) - Math.min(...depths);
    // Pinhole estimate: distance = focal pixels × assumed iris diameter / iris pixels.
    // 11.7 mm iris prior: https://chuoling.github.io/mediapipe/solutions/iris.html
    // Camera intrinsics are unavailable: assume 60° horizontal FOV. Thus absolute
    // centimeters are approximate; calibrated ratios cancel this unknown focal length.
    const irisPixels = (distance(face[469], face[471]) + distance(face[474], face[476])) * height / 2;
    const frontal = metrics.headYaw !== undefined && Math.abs(metrics.headYaw) < 20 && Math.abs(metrics.headPitch ?? 0) < 20;
    const openEyes = (blendshapes.eyeBlinkLeft ?? 0) < .45 && (blendshapes.eyeBlinkRight ?? 0) < .45;
    if (irisPixels >= 3 && frontal && openEyes) {
      const estimate = (width / (2 * Math.tan(Math.PI / 6))) * 1.17 / irisPixels;
      if (estimate >= 15 && estimate <= 250) metrics.distanceCm = estimate;
    }
  }
  if ([11, 12].every(index => visible(pose[index]) && visible(world[index]))) {
    metrics.shoulderDepth = (world[11].z ?? 0) - (world[12].z ?? 0);
    if ([23, 24].every(index => visible(pose[index]) && visible(world[index]))) {
      const shoulderX = (world[11].x + world[12].x) / 2;
      const shoulderY = (world[11].y + world[12].y) / 2;
      const hipX = (world[23].x + world[24].x) / 2;
      const hipY = (world[23].y + world[24].y) / 2;
      metrics.torsoLean = degrees(Math.atan2(shoulderX - hipX, hipY - shoulderY));
    }
    if ([7, 8].every(index => visible(pose[index]))) {
      metrics.shoulderElevation = ((pose[11].y + pose[12].y - pose[7].y - pose[8].y) / 2) / Math.max(distance(pose[11], pose[12]), .001);
    }
  }
  return metrics;
}
