import { EPISODE_URL_TTL_SECONDS } from '@/constants/config';
import { uploadVoiceNote, voiceNotePath } from '@/lib/audio';
import { supabase } from '@/lib/supabase';
import type {
  ClaimRpcResult,
  EndDayRpcResult,
  Message,
  OpeningClaimRpcResult,
  PodcastComment,
  PodcastCommentView,
  PodcastReaction,
  Profile,
  ResponseRpcResult,
  SavedPodcast,
  StartDayRpcResult,
  Thread,
} from '@/types/database';
import type { ActiveRelay, HomeGroupSnapshot } from '@/types/relay';

export async function getMyGroups() {
  const { data, error } = await supabase.from('groups').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getHomeGroups(): Promise<HomeGroupSnapshot[]> {
  const groups = await getMyGroups();
  if (!groups.length) return [];

  const groupIds = groups.map((group) => group.id);
  const { data: memberships, error: memberError } = await supabase
    .from('group_members')
    .select('group_id, user_id')
    .in('group_id', groupIds);
  if (memberError) throw memberError;

  const userIds = [...new Set((memberships ?? []).map((row) => row.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await supabase.from('profiles').select('*').in('id', userIds)
    : { data: [] as Profile[], error: null };
  if (profileError) throw profileError;

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return Promise.all(
    groups.map(async (group) => {
      const thread = await getLatestThread(group.id);
      const message = thread?.current_message_id ? await getMessage(thread.current_message_id) : null;
      const previous = message?.responded_to_message_id
        ? await getMessage(message.responded_to_message_id)
        : null;
      const members = (memberships ?? [])
        .filter((row) => row.group_id === group.id)
        .map((row) => profileById.get(row.user_id))
        .filter((profile): profile is Profile => Boolean(profile));
      return {
        group,
        members,
        thread,
        message,
        previousSenderId: previous?.sender_id ?? null,
        activityAt: message?.created_at ?? thread?.created_at ?? group.created_at,
      };
    })
  );
}

function newMessageId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function parseRpc<T>(data: unknown): T {
  if (typeof data === 'string') {
    return JSON.parse(data) as T;
  }
  return data as T;
}

export async function getActiveThread(groupId: string): Promise<Thread | null> {
  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .order('thread_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLatestThread(groupId: string): Promise<Thread | null> {
  const active = await getActiveThread(groupId);
  if (active) return active;

  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('group_id', groupId)
    .order('thread_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getThreadMessages(threadId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('sequence_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getThread(threadId: string): Promise<Thread | null> {
  const { data, error } = await supabase.from('threads').select('*').eq('id', threadId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActiveMessage(threadId: string): Promise<Message | null> {
  const { data: thread, error: threadError } = await supabase
    .from('threads')
    .select('current_message_id')
    .eq('id', threadId)
    .single();
  if (threadError) throw threadError;
  if (!thread?.current_message_id) return null;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('id', thread.current_message_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMessage(messageId: string): Promise<Message | null> {
  const { data, error } = await supabase.from('messages').select('*').eq('id', messageId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getActiveRelay(groupId: string): Promise<ActiveRelay | null> {
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) throw groupError;
  if (!group) return null;

  const thread = await getActiveThread(groupId);
  if (!thread) {
    return {
      groupId: group.id,
      groupName: group.name,
      thread: null,
      message: null,
      sender: null,
      claimant: null,
    };
  }

  const message = thread.current_message_id ? await getMessage(thread.current_message_id) : null;
  const sender = message?.sender_id ? await getProfile(message.sender_id) : null;
  const claimant = message?.claimed_by ? await getProfile(message.claimed_by) : null;

  return {
    groupId: group.id,
    groupName: group.name,
    thread,
    message,
    sender,
    claimant,
  };
}

export async function claimMessage(messageId: string): Promise<ClaimRpcResult> {
  const { data, error } = await supabase.rpc('claim_message', { p_message_id: messageId });
  if (error) throw error;
  return parseRpc<ClaimRpcResult>(data);
}

async function resolveGroupId(threadId: string, groupId?: string) {
  if (groupId) return groupId;
  const { data: thread, error: threadError } = await supabase
    .from('threads')
    .select('group_id')
    .eq('id', threadId)
    .single();
  if (threadError) throw threadError;
  return thread.group_id;
}

export async function createResponse(params: {
  threadId: string;
  groupId?: string;
  localAudioUri: string;
}): Promise<ResponseRpcResult> {
  const groupId = await resolveGroupId(params.threadId, params.groupId);
  const messageId = newMessageId();
  const audioPath = voiceNotePath(groupId, params.threadId, messageId);
  await uploadVoiceNote(params.localAudioUri, audioPath);

  const { data, error } = await supabase.rpc('create_response_message', {
    p_thread_id: params.threadId,
    p_audio_path: audioPath,
    p_message_id: messageId,
  });
  if (error) throw error;
  return parseRpc<ResponseRpcResult>(data);
}

export async function createOpening(params: {
  threadId: string;
  groupId?: string;
  localAudioUri: string;
}): Promise<ResponseRpcResult> {
  const groupId = await resolveGroupId(params.threadId, params.groupId);
  const messageId = newMessageId();
  const audioPath = voiceNotePath(groupId, params.threadId, messageId);
  await uploadVoiceNote(params.localAudioUri, audioPath);

  const { data, error } = await supabase.rpc('create_opening_message', {
    p_thread_id: params.threadId,
    p_audio_path: audioPath,
    p_message_id: messageId,
  });
  if (error) throw error;
  return parseRpc<ResponseRpcResult>(data);
}

export async function endDay(threadId: string): Promise<EndDayRpcResult> {
  const { data, error } = await supabase.rpc('end_day', { p_thread_id: threadId });
  if (error) throw error;
  return parseRpc<EndDayRpcResult>(data);
}

export async function startNextDay(groupId: string): Promise<StartDayRpcResult> {
  const { data, error } = await supabase.rpc('start_next_day', { p_group_id: groupId });
  if (error) throw error;
  return parseRpc<StartDayRpcResult>(data);
}

export async function claimOpening(threadId: string): Promise<OpeningClaimRpcResult> {
  const { data, error } = await supabase.rpc('claim_opening', { p_thread_id: threadId });
  if (error) throw error;
  return parseRpc<OpeningClaimRpcResult>(data);
}

export async function getSignedAudioUrl(
  messageId: string,
  expiresInSeconds = 60
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const message = await getMessage(messageId);
  if (!message) throw new Error('Message not found');

  const isSender = message.sender_id === user.id;
  const isClaimant = message.claimed_by === user.id;
  let closedThread = false;
  if (!isSender && !isClaimant) {
    const thread = await getThread(message.thread_id);
    closedThread = thread?.status === 'closed';
  }
  if (!isSender && !isClaimant && !closedThread) {
    throw new Error('You cannot listen to this clip');
  }

  const { data, error } = await supabase.storage
    .from('voice-notes')
    .createSignedUrl(message.audio_path, expiresInSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not create playback URL');
  return data.signedUrl;
}

export async function getEpisodeTracks(threadId: string) {
  const messages = await getThreadMessages(threadId);
  const tracks = [];
  for (const message of messages) {
    try {
      const sender = message.sender_id ? await getProfile(message.sender_id) : null;
      const url = await getSignedAudioUrl(message.id, EPISODE_URL_TTL_SECONDS);
      tracks.push({
        url,
        label: sender?.display_name
          ? `${sender.display_name} · note ${message.sequence_number}`
          : `Note ${message.sequence_number}`,
      });
    } catch {
      // Skip clips that were never uploaded (common for the original seed file).
    }
  }
  return tracks;
}

export async function savePodcast(threadId: string) {
  const { data, error } = await supabase.rpc('save_podcast', { p_thread_id: threadId });
  if (error) throw error;
  return parseRpc<{ success: boolean; reason?: string }>(data);
}

export async function unsavePodcast(threadId: string) {
  const { data, error } = await supabase.rpc('unsave_podcast', { p_thread_id: threadId });
  if (error) throw error;
  return parseRpc<{ success: boolean; reason?: string }>(data);
}

export async function isPodcastSaved(threadId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('saved_podcasts')
    .select('thread_id')
    .eq('user_id', user.id)
    .eq('thread_id', threadId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function getSavedPodcasts(): Promise<SavedPodcast[]> {
  const { data: rows, error } = await supabase
    .from('saved_podcasts')
    .select('thread_id, saved_at')
    .order('saved_at', { ascending: false });
  if (error) throw error;
  if (!rows?.length) return [];

  const threadIds = rows.map((row) => row.thread_id);
  const { data: threads, error: threadError } = await supabase
    .from('threads')
    .select('*')
    .in('id', threadIds);
  if (threadError) throw threadError;

  const groupIds = [...new Set((threads ?? []).map((thread) => thread.group_id))];
  const { data: groups, error: groupError } = await supabase
    .from('groups')
    .select('*')
    .in('id', groupIds);
  if (groupError) throw groupError;

  const threadById = new Map((threads ?? []).map((thread) => [thread.id, thread]));
  const groupById = new Map((groups ?? []).map((group) => [group.id, group]));

  return rows.flatMap((row) => {
    const thread = threadById.get(row.thread_id);
    if (!thread) return [];
    const group = groupById.get(thread.group_id);
    return [
      {
        thread_id: row.thread_id,
        saved_at: row.saved_at,
        thread_date: thread.thread_date,
        group_id: thread.group_id,
        group_name: group?.name ?? 'Group',
      },
    ];
  });
}

export async function getPodcastComments(threadId: string): Promise<PodcastCommentView[]> {
  const { data, error } = await supabase
    .from('podcast_comments')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const names = new Map<string, string>();
  const result: PodcastCommentView[] = [];
  for (const row of rows) {
    if (!names.has(row.user_id)) {
      const profile = await getProfile(row.user_id);
      names.set(row.user_id, profile?.display_name ?? 'Friend');
    }
    result.push({ ...row, display_name: names.get(row.user_id) ?? 'Friend' });
  }
  return result;
}

export async function addPodcastComment(threadId: string, body: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Type a comment first');
  const { error } = await supabase.from('podcast_comments').insert({
    thread_id: threadId,
    user_id: user.id,
    body: trimmed,
  });
  if (error) throw error;
}

export async function getPodcastReactions(threadId: string): Promise<PodcastReaction[]> {
  const { data, error } = await supabase
    .from('podcast_reactions')
    .select('*')
    .eq('thread_id', threadId);
  if (error) throw error;
  return data ?? [];
}

export async function togglePodcastReaction(threadId: string, emoji: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data: existing, error: existingError } = await supabase
    .from('podcast_reactions')
    .select('emoji')
    .eq('thread_id', threadId)
    .eq('user_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const { error } = await supabase
      .from('podcast_reactions')
      .delete()
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('podcast_reactions').insert({
    thread_id: threadId,
    user_id: user.id,
    emoji,
  });
  if (error) throw error;
}
