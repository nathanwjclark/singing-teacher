import type { Landmark, Tip, TrackingFrame } from '../types.ts';

const tip = (id: string, title: string, detail: string, severity: Tip['severity'], region: Tip['region'], score: number, muscles?: string[]): Tip =>
  ({ id, title, detail, severity, region, score, ...(muscles ? { muscles } : {}) });
const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const visible = (point: Landmark | undefined) => point && finite(point.x) && finite(point.y) && (point.visibility ?? 1) >= 0.5;
const score = (base: number, amount: number, threshold: number, scale: number) => Math.min(95, base + (amount - threshold) * scale);

/** Visual prompts only. Muscle IDs identify anatomical references, never measured activity.
 * Optional 3D metrics are omitted when unavailable; do not substitute zero for them.
 */
export function getTips(frame: TrackingFrame | null, { limit = 3, uniqueRegions = true, singing = true }: {limit?:number; uniqueRegions?:boolean; singing?:boolean} = {}): Tip[] {
  if (!frame) return [tip('start', 'Make room for your voice.', 'Start your camera, then bring your face and shoulders into view.', 'good', 'general', 0)];
  if (frame.face.length === 0) return [tip('find-face', 'Let’s find your face.', 'Face the camera in even light. Your cues will return when your face is visible.', 'adjust', 'general', 100)];

  const m = frame.metrics;
  const tips: Tip[] = [];
  if (finite(m.brightness) && m.brightness < 45) return [tip('lighting', 'Bring a little light in.', 'Try a light in front of you so the camera can see your face clearly.', 'adjust', 'general', 100)];
  if (!finite(m.mouthOpen) || !finite(m.headTilt) || m.mouthOpen < 0) return [tip('measurement-unavailable', 'Find a clear view.', 'Face the camera and keep your face fully in frame while we look for reliable landmarks.', 'adjust', 'general', 100)];

  if (!singing || m.mouthOpen <= 0.035) return [tip('no-singing', 'No singing detected', 'Sing a comfortable vowel to see live adjustments.', 'good', 'general', 0)];

  // Resolve framing before interpreting geometry near the edge of the image.
  const clipped = frame.face.some(point => point.x < 0.025 || point.x > 0.975 || point.y < 0.025 || point.y > 0.975);
  if (clipped || (finite(m.distanceCm) && m.distanceCm > 0 && m.distanceCm < 35)) {
    return [tip('camera-close', 'Take a little step back.', 'Your face is close to the edge of the camera view. Leave some space around your head and shoulders.', 'adjust', 'general', 100)];
  }
  if (finite(m.distanceCm) && m.distanceCm > 150) {
    return [tip('camera-far', 'Come a little closer.', 'Your face appears small in the camera view. Move closer while keeping both shoulders visible.', 'adjust', 'general', 100)];
  }
  if (finite(m.relativeDepth) && (m.relativeDepth > 1.4 || m.relativeDepth < 0.7)) {
    tips.push(tip('camera-distance', 'Return to your starting spot.', 'Your distance from the camera has changed since calibration. Returning to that spot makes visual comparisons easier.', 'adjust', 'general', 74));
  }

  const yaw = finite(m.headYaw) ? Math.abs(m.headYaw) : undefined;
  const pitch = finite(m.headPitch) ? Math.abs(m.headPitch) : undefined;
  // Face width and asymmetry are strongly distorted by head rotation.
  const frontal = yaw !== undefined && yaw < 15 && pitch !== undefined && pitch < 15;
  const mouthReliable = (yaw === undefined || yaw < 20) && (pitch === undefined || pitch < 20);
  if (mouthReliable && m.mouthOpen > 0.035 && m.mouthOpen < 0.12) {
    tips.push(tip('mouth-open', 'Give the vowel room.', 'On a sustained vowel, try a little more mouth opening—only as far as feels easy. A small opening is normal between phrases.', 'adjust', 'jaw', score(48, 0.12 - m.mouthOpen, 0, 100), ['Masseter', 'Digastric']));
  }
  if (Math.abs(m.headTilt) > 9) {
    tips.push(tip('head-level', 'Find an easy balance.', 'Your head appears tilted sideways. Try returning toward center without holding it rigidly.', 'adjust', 'neck', score(62, Math.abs(m.headTilt), 9, 1.5), ['Sternocleidomastoid']));
  }
  if (yaw !== undefined && yaw > 18) {
    tips.push(tip('head-turn', 'Meet the camera again.', 'Your face appears turned to one side. For this exercise, explore facing forward without fixing your neck in place.', 'adjust', 'neck', score(64, yaw, 18, 1.2), ['Sternocleidomastoid']));
  }
  if (pitch !== undefined && pitch > 16) {
    tips.push(tip('head-pitch', 'Let your gaze come level.', 'Your head appears angled up or down. Place the camera near eye level, then explore a comfortable forward gaze.', 'adjust', 'neck', score(63, pitch, 16, 1.2), ['Sternocleidomastoid']));
  }

  const shouldersVisible = [frame.pose[11], frame.pose[12]].every(visible);
  if (!shouldersVisible || !finite(m.shoulderTilt)) {
    tips.push(tip('show-shoulders', 'Give yourself some space.', 'Keep both shoulders in view so we can offer a shoulder position cue.', 'adjust', 'general', 50));
  } else {
    if (Math.abs(m.shoulderTilt) > 7) {
      tips.push(tip('shoulder-level', 'Let your shoulders settle.', 'One shoulder appears higher. If the camera is level, explore a comfortable, more even position.', 'adjust', 'shoulders', score(60, Math.abs(m.shoulderTilt), 7, 1.6), ['Trapezius', 'Levator scapulae']));
    }
    if (finite(m.shoulderDepth) && Math.abs(m.shoulderDepth) > 0.09) {
      tips.push(tip('shoulder-rotation', 'Face the phrase together.', 'One shoulder appears closer to the camera. Explore bringing your chest and face toward the same direction without bracing.', 'adjust', 'chest', score(66, Math.abs(m.shoulderDepth), 0.09, 100), ['Pectoralis major', 'External oblique']));
    }
    if (frontal && finite(m.shoulderElevation) && m.shoulderElevation >= 0 && m.shoulderElevation < 0.2) {
      tips.push(tip('shoulder-elevation', 'Make space by your ears.', 'Your shoulders appear close to your ears in this view. If you are lifting them, let them return to a comfortable resting height between phrases.', 'adjust', 'shoulders', score(64, 0.2 - m.shoulderElevation, 0, 80), ['Trapezius', 'Levator scapulae']));
    }
    const hipsVisible = [frame.pose[23], frame.pose[24]].every(visible);
    if (hipsVisible && finite(m.torsoLean) && Math.abs(m.torsoLean) > 8) {
      tips.push(tip('torso-lean', 'Find your center.', 'Your torso appears to lean sideways. With the camera level, explore balancing over your hips while keeping movement available.', 'adjust', 'torso', score(65, Math.abs(m.torsoLean), 8, 1.5), ['External oblique', 'Erector spinae']));
    }
  }

  if (frontal && finite(m.jawAsymmetry) && m.jawAsymmetry > 0.18 && m.mouthOpen > 0.12) {
    tips.push(tip('jaw-asymmetry', 'Explore an easy opening.', 'Your lip corners sit unevenly relative to your chin in this view. On a sustained vowel, try an easy opening without forcing symmetry; natural differences are normal.', 'adjust', 'jaw', score(55, m.jawAsymmetry, 0.18, 60), ['Masseter', 'Digastric']));
  }
  if (frontal && finite(m.lipWidth) && m.lipWidth > 0.88 && m.mouthOpen > 0.12) {
    tips.push(tip('lip-spread', 'Explore a rounder vowel.', 'Your lips appear spread sideways. On a sustained vowel, explore a rounder shape if it suits that vowel. Different vowels need different shapes.', 'adjust', 'lips', score(54, m.lipWidth, 0.88, 65), ['Orbicularis oris']));
  }

  if (tips.length === 0) return [tip('keep-exploring', 'Keep the phrase flowing.', 'No large visible adjustments right now. Explore an easy vowel and notice what feels comfortable.', 'good', 'general', 0)];
  // Keep the strongest cue per region so three neck observations cannot crowd out the body.
  const regions = new Set<Tip['region']>();
  const ranked = tips.sort((a, b) => b.score - a.score).filter(item => {
    if (uniqueRegions && regions.has(item.region)) return false;
    regions.add(item.region);
    return true;
  }).slice(0, limit);
  return ranked.map((item, index) => ({ ...item, severity: index === 0 && item.region !== 'general' ? 'focus' : item.severity }));
}

/** A missing cue is not success: require a fresh, usable view and a measured
 * change past the cue threshold. Call only while voice remains active. */
export function resolvedTipIds(previous: TrackingFrame | null, current: TrackingFrame | null): Set<string> {
  const resolved = new Set<string>();
  if (!previous || !current || current.timestamp <= previous.timestamp) return resolved;
  const cues = getTips(current, {limit:12,uniqueRegions:false});
  if (cues.some(cue => ['start','find-face','lighting','measurement-unavailable','camera-close','camera-far','no-singing'].includes(cue.id))) return resolved;
  const before = previous.metrics, after = current.metrics;
  const changedBelow = (key: keyof typeof after, threshold: number, absolute = true) => {
    const a = before[key], b = after[key];
    if (!finite(a) || !finite(b)) return false;
    const old = absolute ? Math.abs(a) : a, next = absolute ? Math.abs(b) : b;
    return old > threshold && next <= threshold;
  };
  if (changedBelow('headTilt',9)) resolved.add('head-level');
  if (changedBelow('headYaw',18)) resolved.add('head-turn');
  if (changedBelow('headPitch',16)) resolved.add('head-pitch');
  const frontal = finite(after.headYaw) && Math.abs(after.headYaw) < 15 && finite(after.headPitch) && Math.abs(after.headPitch) < 15;
  const mouthReliable = (after.headYaw === undefined || Math.abs(after.headYaw) < 20) && (after.headPitch === undefined || Math.abs(after.headPitch) < 20);
  if (mouthReliable && before.mouthOpen > 0.035 && before.mouthOpen < 0.12 && after.mouthOpen >= 0.12) resolved.add('mouth-open');
  if (frontal && after.mouthOpen > 0.12) {
    if (changedBelow('jawAsymmetry',0.18,false)) resolved.add('jaw-asymmetry');
    if (changedBelow('lipWidth',0.88,false)) resolved.add('lip-spread');
  }
  if ([current.pose[11],current.pose[12]].every(visible)) {
    if (changedBelow('shoulderTilt',7)) resolved.add('shoulder-level');
    if (changedBelow('shoulderDepth',0.09)) resolved.add('shoulder-rotation');
    if (frontal && finite(before.shoulderElevation) && before.shoulderElevation >= 0 && before.shoulderElevation < 0.2 && finite(after.shoulderElevation) && after.shoulderElevation >= 0.2) resolved.add('shoulder-elevation');
    if ([current.pose[23],current.pose[24]].every(visible) && changedBelow('torsoLean',8)) resolved.add('torso-lean');
  }
  return resolved;
}
