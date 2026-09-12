export type ThreadStatus = 'active' | 'closed';

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Group = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  joined_at: string;
};

export type Thread = {
  id: string;
  group_id: string;
  thread_date: string;
  status: ThreadStatus;
  current_message_id: string | null;
  last_claimed_by: string | null;
  consecutive_claims: number;
  created_at: string;
  opening_claimed_by: string | null;
  opening_claimed_at: string | null;
};

export type SavedPodcastRow = {
  user_id: string;
  thread_id: string;
  saved_at: string;
};

export type SavedPodcast = {
  thread_id: string;
  saved_at: string;
  thread_date: string;
  group_id: string;
  group_name: string;
};

export type Message = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  audio_path: string;
  sequence_number: number;
  responded_to_message_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
};

export type PodcastComment = {
  id: string;
  thread_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type PodcastReaction = {
  thread_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type PodcastCommentView = PodcastComment & {
  display_name: string;
};

type Table<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Tables: {
      profiles: Table<Profile>;
      groups: Table<Group>;
      group_members: Table<GroupMember>;
      threads: Table<Thread>;
      messages: Table<Message>;
      saved_podcasts: Table<SavedPodcastRow>;
      podcast_comments: Table<PodcastComment>;
      podcast_reactions: Table<PodcastReaction>;
    };
    Functions: {
      claim_message: {
        Args: { p_message_id: string };
        Returns: ClaimRpcResult;
      };
      create_response_message: {
        Args: {
          p_thread_id: string;
          p_audio_path: string;
          p_message_id?: string;
        };
        Returns: ResponseRpcResult;
      };
      create_opening_message: {
        Args: {
          p_thread_id: string;
          p_audio_path: string;
          p_message_id?: string;
        };
        Returns: ResponseRpcResult;
      };
      end_day: {
        Args: { p_thread_id: string };
        Returns: EndDayRpcResult;
      };
      start_next_day: {
        Args: { p_group_id: string };
        Returns: StartDayRpcResult;
      };
      claim_opening: {
        Args: { p_thread_id: string };
        Returns: OpeningClaimRpcResult;
      };
      save_podcast: {
        Args: { p_thread_id: string };
        Returns: { success: boolean; reason?: string; thread_id?: string; saved_at?: string };
      };
      unsave_podcast: {
        Args: { p_thread_id: string };
        Returns: { success: boolean; reason?: string; thread_id?: string };
      };
    };
  };
};

export type ClaimFailureReason =
  | 'unauthenticated'
  | 'not_found'
  | 'not_group_member'
  | 'thread_closed'
  | 'not_current_message'
  | 'already_claimed'
  | 'own_message'
  | 'too_soon';

export type ClaimRpcResult =
  | {
      success: true;
      message_id: string;
      claimed_by: string;
      claimed_at: string;
    }
  | {
      success: false;
      reason: ClaimFailureReason;
      claimed_by?: string;
    };

export type ResponseRpcResult =
  | {
      success: true;
      message_id: string;
      thread_id: string;
      sequence_number: number;
    }
  | {
      success: false;
      reason: string;
    };

export type EndDayRpcResult =
  | {
      success: true;
      thread_id: string;
      message_count: number;
      already_closed?: boolean;
    }
  | {
      success: false;
      reason: string;
    };

export type StartDayRpcResult =
  | {
      success: true;
      thread_id: string;
      thread_date: string;
    }
  | {
      success: false;
      reason: string;
    };

export type OpeningClaimRpcResult =
  | {
      success: true;
      thread_id: string;
      claimed_by: string;
      claimed_at: string;
    }
  | {
      success: false;
      reason: string;
      claimed_by?: string;
    };
