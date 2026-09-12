INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-notes',
  'voice-notes',
  false,
  5242880,
  ARRAY[
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
    'audio/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "voice_notes_select_sender_or_claimant" ON storage.objects;
DROP POLICY IF EXISTS "voice_notes_select_member_clip" ON storage.objects;
DROP POLICY IF EXISTS "voice_notes_insert_member" ON storage.objects;
DROP POLICY IF EXISTS "voice_notes_update_own" ON storage.objects;
DROP POLICY IF EXISTS "voice_notes_delete_own" ON storage.objects;

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
        AND (m.sender_id = auth.uid() OR m.claimed_by = auth.uid())
    )
  )
);

CREATE POLICY "voice_notes_insert_member"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'voice-notes'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.user_id = auth.uid()
      AND gm.group_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY "voice_notes_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.user_id = auth.uid()
        AND gm.group_id::text = split_part(name, '/', 1)
    )
  )
)
WITH CHECK (
  bucket_id = 'voice-notes'
  AND EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.user_id = auth.uid()
      AND gm.group_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY "voice_notes_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'voice-notes'
  AND owner = auth.uid()
);
