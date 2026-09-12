-- Close a day's thread (hackathon: tap End day in the app).
-- After close, group members may listen to every clip in the recap.

CREATE OR REPLACE FUNCTION public.end_day(p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_thread public.threads%ROWTYPE;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  SELECT *
    INTO v_thread
  FROM public.threads
  WHERE id = p_thread_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  IF NOT public.is_group_member(v_thread.group_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_group_member');
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.messages
  WHERE thread_id = v_thread.id;

  IF v_thread.status = 'closed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'thread_id', v_thread.id,
      'message_count', v_count,
      'already_closed', true
    );
  END IF;

  UPDATE public.threads
  SET status = 'closed'
  WHERE id = v_thread.id;

  RETURN jsonb_build_object(
    'success', true,
    'thread_id', v_thread.id,
    'message_count', v_count,
    'already_closed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_next_day(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_next date;
  v_thread public.threads%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  IF NOT public.is_group_member(p_group_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_group_member');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.threads
    WHERE group_id = p_group_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_active');
  END IF;

  SELECT COALESCE(MAX(thread_date), CURRENT_DATE - 1) + 1
    INTO v_next
  FROM public.threads
  WHERE group_id = p_group_id;

  INSERT INTO public.threads (group_id, thread_date, status)
  VALUES (p_group_id, v_next, 'active')
  RETURNING * INTO v_thread;

  RETURN jsonb_build_object(
    'success', true,
    'thread_id', v_thread.id,
    'thread_date', v_thread.thread_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_opening_message(
  p_thread_id uuid,
  p_audio_path text,
  p_message_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_thread public.threads%ROWTYPE;
  v_new public.messages%ROWTYPE;
  v_expected_prefix text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  IF p_audio_path IS NULL OR length(trim(p_audio_path)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_audio_path');
  END IF;

  SELECT *
    INTO v_thread
  FROM public.threads
  WHERE id = p_thread_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  IF NOT public.is_group_member(v_thread.group_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_group_member');
  END IF;

  IF v_thread.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'thread_closed');
  END IF;

  IF v_thread.current_message_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_has_message');
  END IF;

  v_expected_prefix := v_thread.group_id::text || '/' || v_thread.id::text || '/';
  IF p_audio_path NOT LIKE v_expected_prefix || '%' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_audio_path');
  END IF;

  INSERT INTO public.messages (
    id,
    thread_id,
    sender_id,
    audio_path,
    sequence_number
  )
  VALUES (
    p_message_id,
    v_thread.id,
    v_user,
    p_audio_path,
    1
  )
  RETURNING * INTO v_new;

  UPDATE public.threads
  SET current_message_id = v_new.id
  WHERE id = v_thread.id;

  RETURN jsonb_build_object(
    'success', true,
    'message_id', v_new.id,
    'thread_id', v_thread.id,
    'sequence_number', v_new.sequence_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.end_day(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_next_day(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_opening_message(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_day(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_next_day(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_opening_message(uuid, text, uuid) TO authenticated;

DROP POLICY IF EXISTS "voice_notes_select_member_clip" ON storage.objects;

CREATE POLICY "voice_notes_select_member_clip"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.threads t ON t.id = m.thread_id
      JOIN public.group_members gm
        ON gm.group_id = t.group_id
       AND gm.user_id = auth.uid()
      WHERE m.audio_path = name
        AND (
          m.sender_id = auth.uid()
          OR m.claimed_by = auth.uid()
          OR t.status = 'closed'
        )
    )
  )
);
