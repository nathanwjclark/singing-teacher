/** A periodic voice-like sound, not a classifier for singing versus speech. */
export type VoiceActivity = { voiced: boolean; at: number };
export function hasRecentVoice(activity: VoiceActivity | null | undefined, now: number): boolean {
  return !!activity?.voiced && now >= activity.at && now - activity.at < 650;
}

/** Keep the timestamp of the last voiced window, so brief pitch dropouts do not
 * silence all coaching. Unvoiced windows never extend the hold. */
export function updateVoiceActivity(previous: VoiceActivity | null, voiced: boolean, now: number): VoiceActivity {
  if (voiced) return { voiced: true, at: now };
  if (hasRecentVoice(previous, now)) return previous!;
  return { voiced: false, at: now };
}
