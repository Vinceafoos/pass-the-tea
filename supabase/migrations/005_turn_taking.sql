-- Turn-taking: you cannot claim your own note, and you cannot claim
-- the reply to your own note. Two other people must speak first.

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

  IF v_message.claimed_by = v_user AND NOT v_expired THEN
    RETURN jsonb_build_object(
      'success', true,
      'message_id', v_message.id,
      'claimed_by', v_user,
      'claimed_at', v_message.claimed_at
    );
  END IF;

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

GRANT EXECUTE ON FUNCTION public.claim_message(uuid) TO authenticated;
