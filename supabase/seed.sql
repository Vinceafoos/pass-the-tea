-- Development seed for the two-device claim race.
-- Auth users cannot be created reliably from SQL. Create them in the dashboard first,
-- then replace the UUIDs below and run this in the SQL editor.

-- 1. In Authentication > Users, create:
--    alex@example.com
--    jamie@example.com
--    sam@example.com
--    (optional outsider) outsider@example.com
-- 2. Confirm each user has a matching row in public.profiles (auto-created by trigger).
-- 3. Paste their user UUIDs here and run the rest of the file.

DO $$
DECLARE
  v_alex uuid := 'e757cb01-8d57-4461-92b9-b1bfac20ff87'; -- replace
  v_jamie uuid := '942ee507-c647-46c9-8fac-aed525f4adea'; -- replace
  v_sam uuid := 'c3ae5e27-dac7-4a4b-ae04-d4c85e8c4fd6'; -- replace
  v_group uuid := '11111111-1111-1111-1111-111111111111';
  v_thread uuid := '22222222-2222-2222-2222-222222222222';
  v_message uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_alex)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_jamie)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_sam) THEN
    RAISE EXCEPTION 'Replace the seed user UUIDs with real auth.users ids before running this seed';
  END IF;

  UPDATE public.profiles SET display_name = 'Alex' WHERE id = v_alex;
  UPDATE public.profiles SET display_name = 'Jamie' WHERE id = v_jamie;
  UPDATE public.profiles SET display_name = 'Sam' WHERE id = v_sam;

  INSERT INTO public.groups (id, name, created_by)
  VALUES (v_group, 'Hackathon Friends', v_alex)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.group_members (group_id, user_id)
  VALUES
    (v_group, v_alex),
    (v_group, v_jamie),
    (v_group, v_sam)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.threads (
    id,
    group_id,
    thread_date,
    status,
    current_message_id,
    last_claimed_by,
    consecutive_claims
  )
  VALUES (
    v_thread,
    v_group,
    CURRENT_DATE,
    'active',
    NULL,
    NULL,
    0
  )
  ON CONFLICT (group_id, thread_date) DO UPDATE
    SET status = 'active';

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
    v_message,
    v_thread,
    v_alex,
    v_group::text || '/' || v_thread::text || '/' || v_message::text || '.m4a',
    1,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
    SET claimed_by = NULL,
        claimed_at = NULL;

  UPDATE public.threads
  SET current_message_id = v_message,
      last_claimed_by = NULL,
      consecutive_claims = 0
  WHERE id = v_thread;
END $$;
