-- Run in the SQL editor after seed users exist.
-- Replace the UUIDs, then execute. Notices print PASS/FAIL.

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_a uuid := '00000000-0000-0000-0000-000000000001'; -- Alex
  v_b uuid := '00000000-0000-0000-0000-000000000002'; -- Jamie
  v_c uuid := '00000000-0000-0000-0000-000000000003'; -- Sam
  v_outsider uuid := '00000000-0000-0000-0000-000000000099'; -- not in group
  v_group uuid := '11111111-1111-1111-1111-111111111111';
  v_thread uuid;
  v_msg1 uuid;
  v_msg2 uuid;
  v_msg3 uuid;
  v_old uuid;
  r jsonb;
BEGIN
  SELECT id INTO v_thread FROM public.threads WHERE group_id = v_group AND thread_date = CURRENT_DATE;
  IF v_thread IS NULL THEN
    RAISE EXCEPTION 'Seed the group/thread first';
  END IF;

  INSERT INTO public.messages (thread_id, sender_id, audio_path, sequence_number)
  VALUES (v_thread, v_c, v_group::text || '/' || v_thread::text || '/test-1.m4a',
          (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM public.messages WHERE thread_id = v_thread))
  RETURNING id INTO v_msg1;

  UPDATE public.threads
  SET current_message_id = v_msg1,
      last_claimed_by = NULL,
      consecutive_claims = 0
  WHERE id = v_thread;

  PERFORM pg_temp.as_user(v_a);
  r := public.claim_message(v_msg1);
  IF (r ->> 'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'User A claims unclaimed message -> expected success, got %', r;
  END IF;
  RAISE NOTICE 'PASS: User A claims unclaimed message';

  PERFORM pg_temp.as_user(v_b);
  r := public.claim_message(v_msg1);
  IF r ->> 'reason' IS DISTINCT FROM 'already_claimed' THEN
    RAISE EXCEPTION 'User B afterward -> expected already_claimed, got %', r;
  END IF;
  RAISE NOTICE 'PASS: User B claims same message afterward -> already_claimed';

  UPDATE public.messages
  SET claimed_at = now() - interval '11 minutes'
  WHERE id = v_msg1;

  PERFORM pg_temp.as_user(v_b);
  r := public.claim_message(v_msg1);
  IF (r ->> 'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Expired claim -> expected B success, got %', r;
  END IF;
  RAISE NOTICE 'PASS: Expired claim -> another user may claim';

  INSERT INTO public.messages (thread_id, sender_id, audio_path, sequence_number)
  VALUES (v_thread, v_a, v_group::text || '/' || v_thread::text || '/test-2.m4a',
          (SELECT MAX(sequence_number) + 1 FROM public.messages WHERE thread_id = v_thread))
  RETURNING id INTO v_msg2;

  UPDATE public.threads
  SET current_message_id = v_msg2,
      last_claimed_by = NULL,
      consecutive_claims = 0
  WHERE id = v_thread;

  PERFORM pg_temp.as_user(v_outsider);
  r := public.claim_message(v_msg2);
  IF r ->> 'reason' IS DISTINCT FROM 'not_group_member' THEN
    RAISE EXCEPTION 'Non-member -> expected not_group_member, got %', r;
  END IF;
  RAISE NOTICE 'PASS: Non-group member -> rejected';

  v_old := v_msg1;
  PERFORM pg_temp.as_user(v_a);
  r := public.claim_message(v_old);
  IF r ->> 'reason' IS DISTINCT FROM 'not_current_message' THEN
    RAISE EXCEPTION 'Non-current -> expected not_current_message, got %', r;
  END IF;
  RAISE NOTICE 'PASS: Non-current message -> rejected';

  PERFORM pg_temp.as_user(v_a);
  r := public.claim_message(v_msg2);
  IF r ->> 'reason' IS DISTINCT FROM 'own_message' THEN
    RAISE EXCEPTION 'Own message -> expected own_message, got %', r;
  END IF;
  RAISE NOTICE 'PASS: Sender cannot claim their own message';

  -- Reply to A: B sent it in response to msg2 (A). A cannot claim.
  INSERT INTO public.messages (
    thread_id, sender_id, audio_path, sequence_number, responded_to_message_id
  )
  VALUES (
    v_thread, v_b, v_group::text || '/' || v_thread::text || '/test-3.m4a',
    (SELECT MAX(sequence_number) + 1 FROM public.messages WHERE thread_id = v_thread),
    v_msg2
  )
  RETURNING id INTO v_msg3;

  UPDATE public.threads SET current_message_id = v_msg3 WHERE id = v_thread;

  PERFORM pg_temp.as_user(v_a);
  r := public.claim_message(v_msg3);
  IF r ->> 'reason' IS DISTINCT FROM 'too_soon' THEN
    RAISE EXCEPTION 'Reply to self -> expected too_soon, got %', r;
  END IF;
  RAISE NOTICE 'PASS: Cannot claim a reply to yourself';

  -- After two others (B then C), A may return.
  INSERT INTO public.messages (
    thread_id, sender_id, audio_path, sequence_number, responded_to_message_id
  )
  VALUES (
    v_thread, v_c, v_group::text || '/' || v_thread::text || '/test-4.m4a',
    (SELECT MAX(sequence_number) + 1 FROM public.messages WHERE thread_id = v_thread),
    v_msg3
  )
  RETURNING id INTO v_msg1;

  UPDATE public.threads SET current_message_id = v_msg1 WHERE id = v_thread;

  PERFORM pg_temp.as_user(v_a);
  r := public.claim_message(v_msg1);
  IF (r ->> 'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'After two others -> expected A success, got %', r;
  END IF;
  RAISE NOTICE 'PASS: Original sender can claim after two other people have spoken';

  RAISE NOTICE 'PASS: sequential claim cases. For simultaneous claims, use two app clients; FOR UPDATE allows only one winner.';
END $$;
