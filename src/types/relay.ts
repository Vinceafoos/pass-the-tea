import type { Group, Message, Profile, Thread } from '@/types/database';

export type HomeGroupSnapshot = {
  group: Group;
  members: Profile[];
  thread: Thread | null;
  message: Message | null;
  activityAt: string | null;
};

export type RelayStatusKind =
  | 'unclaimed'
  | 'claimed_by_me'
  | 'claimed_by_other'
  | 'own_message'
  | 'too_soon'
  | 'loading'
  | 'empty';

export type ActiveRelay = {
  groupId: string;
  groupName: string;
  thread: Thread | null;
  message: Message | null;
  sender: Profile | null;
  claimant: Profile | null;
};

export type ClaimUiState = {
  kind: RelayStatusKind;
  claimantName?: string;
};
