-- Group members can react and comment after a day's recap is released (thread closed).

CREATE OR REPLACE FUNCTION public.can_discuss_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.threads t
    WHERE t.id = p_thread_id
      AND t.status = 'closed'
      AND public.is_group_member(t.group_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_discuss_thread(uuid) TO authenticated;

CREATE TABLE public.podcast_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.threads (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX podcast_comments_thread_id_created_at_idx
  ON public.podcast_comments (thread_id, created_at);

CREATE TABLE public.podcast_reactions (
  thread_id uuid NOT NULL REFERENCES public.threads (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('❤️', '🔥', '😂', '👏', '😮')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id, emoji)
);

ALTER TABLE public.podcast_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.podcast_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "podcast_comments_select_member"
  ON public.podcast_comments
  FOR SELECT
  TO authenticated
  USING (public.can_discuss_thread(thread_id));

CREATE POLICY "podcast_comments_insert_own"
  ON public.podcast_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_discuss_thread(thread_id)
  );

CREATE POLICY "podcast_comments_delete_own"
  ON public.podcast_comments
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "podcast_reactions_select_member"
  ON public.podcast_reactions
  FOR SELECT
  TO authenticated
  USING (public.can_discuss_thread(thread_id));

CREATE POLICY "podcast_reactions_insert_own"
  ON public.podcast_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_discuss_thread(thread_id)
  );

CREATE POLICY "podcast_reactions_delete_own"
  ON public.podcast_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON TABLE public.podcast_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.podcast_reactions TO authenticated;
GRANT ALL ON TABLE public.podcast_comments TO service_role;
GRANT ALL ON TABLE public.podcast_reactions TO service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.podcast_comments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.podcast_reactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
