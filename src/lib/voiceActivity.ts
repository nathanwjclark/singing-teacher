/** A periodic voice-like sound, not a classifier for singing versus speech. */
export type VoiceActivity = { voiced: boolean; at: number };
export function hasRecentVoice(activity: VoiceActivity | null | undefined, now: number): boolean {
  return !!activity?.voiced && now >= activity.at && now - activity.at < 650;
}
