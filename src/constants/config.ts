export const CLAIM_TTL_MS = 10 * 60 * 1000;
export const MAX_RECORDING_SECONDS = 10;
export const EPISODE_GAP_MS = 500;
export const EPISODE_URL_TTL_SECONDS = 60 * 60;
export const PODCAST_EMOJIS = ['❤️', '🔥', '😂', '👏', '😮'] as const;

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  claimTtlMs: CLAIM_TTL_MS,
  maxRecordingSeconds: MAX_RECORDING_SECONDS,
  episodeGapMs: EPISODE_GAP_MS,
};

export function isSupabaseConfigured() {
  return (
    config.supabaseUrl.startsWith('http') &&
    config.supabaseAnonKey.length > 0 &&
    !config.supabaseUrl.includes('YOUR_PROJECT')
  );
}
