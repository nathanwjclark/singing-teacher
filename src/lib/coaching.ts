import type { Tip, TrackingFrame } from '../types.ts';

const tip = (id: string, title: string, detail: string, severity: Tip['severity'], region: Tip['region'], score: number): Tip =>
  ({ id, title, detail, severity, region, score });

/** Visual practice prompts, not an assessment of sound, anatomy, or muscle tension. */
export function getTips(frame: TrackingFrame | null): Tip[] {
  if (!frame) {
    return [tip('start', 'Make room for your voice.', 'Start your camera, then bring your face and shoulders into view.', 'good', 'general', 0)];
  }
  if (frame.face.length === 0) {
    return [tip('find-face', 'Let’s find your face.', 'Face the camera in even light. Your cues will return when your face is visible.', 'adjust', 'general', 100)];
  }

  const { mouthOpen, headTilt, shoulderTilt, brightness } = frame.metrics;
  const tips: Tip[] = [];
  if (Number.isFinite(brightness) && brightness < 45) {
    return [tip('lighting', 'Bring a little light in.', 'Try a light in front of you so the camera can see your face clearly.', 'adjust', 'general', 100)];
  }
  if (!Number.isFinite(mouthOpen) || !Number.isFinite(headTilt) || mouthOpen < 0) {
    return [tip('measurement-unavailable', 'Find a clear view.', 'Face the camera and keep your face fully in frame while we look for reliable landmarks.', 'adjust', 'general', 100)];
  }
  if (Number.isFinite(mouthOpen) && mouthOpen >= 0 && mouthOpen < 0.12) {
    tips.push(tip('mouth-open', 'Give the vowel room.', 'On a sustained vowel, try a little more mouth opening—only as far as feels easy. A small opening is normal between phrases.', 'focus', 'jaw', 90));
  }
  if (Number.isFinite(headTilt) && Math.abs(headTilt) > 9) {
    tips.push(tip('head-level', 'Find an easy balance.', 'Your head appears tilted sideways. Try returning toward center without holding it rigidly.', 'adjust', 'neck', 75));
  }

  const shoulders = [frame.pose[11], frame.pose[12]];
  const shouldersVisible = shoulders.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.5);
  if (!shouldersVisible) {
    tips.push(tip('show-shoulders', 'Give yourself some space.', 'Step back until both shoulders are in view so we can offer a shoulder position cue.', 'adjust', 'general', 50));
  } else if (!Number.isFinite(shoulderTilt)) {
    tips.push(tip('show-shoulders', 'Give yourself some space.', 'Keep both shoulders in view while we look for a reliable shoulder position.', 'adjust', 'general', 50));
  } else if (Math.abs(shoulderTilt) > 7) {
    tips.push(tip('shoulder-level', 'Let your shoulders settle.', 'One shoulder appears higher. If the camera is level, explore a comfortable, more even position.', 'adjust', 'shoulders', 65));
  }

  if (tips.length === 0) {
    tips.push(tip('keep-exploring', 'Keep the phrase flowing.', 'No large visible adjustments right now. Explore an easy vowel and notice what feels comfortable.', 'good', 'general', 0));
  }
  return tips.sort((a, b) => b.score - a.score).slice(0, 3);
}
