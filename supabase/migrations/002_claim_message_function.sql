-- Atomic claim + response. Callers must use these RPCs, not direct updates.

CREATE OR REPLACE FUNCTION public.claim_is_expired(p_claimed_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_claimed_at IS NULL OR p_claimed_at < now() - interval '10 minutes';
$$;

CREATE OR REPLACE FUNCTION public.claim_message(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_thread_id uuid;
  v_thread public.threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_now timestamptz := now();
  v_expired boolean;
  v_prev_sender uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  SELECT m.thread_id
    INTO v_thread_id
  FROM public.messages m
  WHERE m.id = p_message_id;

  IF v_thread_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  -- Serialize all claim/response activity for this thread.
  SELECT *
    INTO v_thread
  FROM public.threads
  WHERE id = v_thread_id
  FOR UPDATE;

  SELECT *
    INTO v_message
  FROM public.messages
  WHERE id = p_message_id
  FOR UPDATE;

  IF NOT public.is_group_member(v_thread.group_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_group_member');
  END IF;

  IF v_thread.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'thread_closed');
  END IF;

  IF v_thread.current_message_id IS DISTINCT FROM p_message_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_current_message');
  END IF;

  v_expired :=
    v_message.claimed_by IS NULL
    OR public.claim_is_expired(v_message.claimed_at);

  IF v_message.claimed_by IS NOT NULL
     AND NOT v_expired
     AND v_message.claimed_by IS DISTINCT FROM v_user THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'already_claimed',
      'claimed_by', v_message.claimed_by
    );
  END IF;

  -- Already holds a live claim: idempotent success (double-tap).
  IF v_message.claimed_by = v_user AND NOT v_expired THEN
    RETURN jsonb_build_object(
      'success', true,
      'message_id', v_message.id,
      'claimed_by', v_user,
      'claimed_at', v_message.claimed_at
    );
  END IF;

  -- Cannot claim a note you sent, and cannot claim the reply to a note you sent.
  -- That means two other people must speak before you can take a turn again.
  IF v_message.sender_id = v_user THEN
    RETURN jsonb_build_object('success', false, 'reason', 'own_message');
  END IF;

  IF v_message.responded_to_message_id IS NOT NULL THEN
    SELECT sender_id
      INTO v_prev_sender
    FROM public.messages
    WHERE id = v_message.responded_to_message_id;

    IF v_prev_sender = v_user THEN
      RETURN jsonb_build_object('success', false, 'reason', 'too_soon');
    END IF;
  END IF;

  UPDATE public.messages
  SET claimed_by = v_user,
      claimed_at = v_now
  WHERE id = p_message_id;

  IF v_message.claimed_by = v_user THEN
    -- Refreshing an expired self-claim does not increment the streak.
    NULL;
  ELSIF v_thread.last_claimed_by = v_user THEN
    UPDATE public.threads
    SET consecutive_claims = consecutive_claims + 1
    WHERE id = v_thread.id;
  ELSE
    UPDATE public.threads
    SET last_claimed_by = v_user,
        consecutive_claims = 1
    WHERE id = v_thread.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message_id', p_message_id,
    'claimed_by', v_user,
    'claimed_at', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_response_message(
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
  v_current public.messages%ROWTYPE;
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

  IF v_thread.current_message_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_current_message');
  END IF;

  SELECT *
    INTO v_current
  FROM public.messages
  WHERE id = v_thread.current_message_id
  FOR UPDATE;

  IF v_current.claimed_by IS DISTINCT FROM v_user THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_claimant');
  END IF;

  IF public.claim_is_expired(v_current.claimed_at) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'claim_expired');
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
    sequence_number,
    responded_to_message_id,
    claimed_by,
    claimed_at
  )
  VALUES (
    p_message_id,
    v_thread.id,
    v_user,
    p_audio_path,
    v_current.sequence_number + 1,
    v_current.id,
    NULL,
    NULL
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

REVOKE ALL ON FUNCTION public.claim_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_response_message(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_response_message(uuid, text, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_group_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;
