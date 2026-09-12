-- First-note slot is claimed, same as a regular claim. Others wait until send or expiry.

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS opening_claimed_by uuid REFERENCES public.profiles (id);

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS opening_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_opening(p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_thread public.threads%ROWTYPE;
  v_now timestamptz := now();
  v_expired boolean;
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

  IF v_thread.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'thread_closed');
  END IF;

  IF v_thread.current_message_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_has_message');
  END IF;

  v_expired :=
    v_thread.opening_claimed_by IS NULL
    OR public.claim_is_expired(v_thread.opening_claimed_at);

  IF v_thread.opening_claimed_by IS NOT NULL
     AND NOT v_expired
     AND v_thread.opening_claimed_by IS DISTINCT FROM v_user THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'already_claimed',
      'claimed_by', v_thread.opening_claimed_by
    );
  END IF;

  IF v_thread.opening_claimed_by = v_user AND NOT v_expired THEN
    RETURN jsonb_build_object(
      'success', true,
      'thread_id', v_thread.id,
      'claimed_by', v_user,
      'claimed_at', v_thread.opening_claimed_at
    );
  END IF;

  UPDATE public.threads
  SET opening_claimed_by = v_user,
      opening_claimed_at = v_now
  WHERE id = v_thread.id;

  RETURN jsonb_build_object(
    'success', true,
    'thread_id', v_thread.id,
    'claimed_by', v_user,
    'claimed_at', v_now
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

  IF v_thread.opening_claimed_by IS DISTINCT FROM v_user
     OR public.claim_is_expired(v_thread.opening_claimed_at) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_claimant');
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
  SET current_message_id = v_new.id,
      opening_claimed_by = NULL,
      opening_claimed_at = NULL
  WHERE id = v_thread.id;

  RETURN jsonb_build_object(
    'success', true,
    'message_id', v_new.id,
    'thread_id', v_thread.id,
    'sequence_number', v_new.sequence_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_opening(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_opening(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_opening_message(uuid, text, uuid) TO authenticated;
