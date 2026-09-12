import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';

import { supabase } from '@/lib/supabase';

export async function requestMicPermission() {
  const result = await requestRecordingPermissionsAsync();
  return result.granted;
}

export async function prepareAudioMode() {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
  });
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function voiceNotePath(groupId: string, threadId: string, messageId: string) {
  return `${groupId}/${threadId}/${messageId}.m4a`;
}

export async function uploadVoiceNote(localUri: string, storagePath: string) {
  const response = await fetch(localUri);
  if (!response.ok) {
    throw new Error('Could not read the recorded file');
  }
  const bytes = await response.arrayBuffer();
  const { error } = await supabase.storage.from('voice-notes').upload(storagePath, bytes, {
    contentType: 'audio/mp4',
    upsert: false,
  });
  if (error) throw error;
  return storagePath;
}
