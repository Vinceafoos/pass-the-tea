-- Personal archive of closed-day recaps. Saving is optional and per user.

CREATE TABLE public.saved_podcasts (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads (id) ON DELETE CASCADE,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX saved_podcasts_user_id_saved_at_idx
  ON public.saved_podcasts (user_id, saved_at DESC);

ALTER TABLE public.saved_podcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_podcasts_select_own"
  ON public.saved_podcasts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON TABLE public.saved_podcasts TO authenticated;
GRANT ALL ON TABLE public.saved_podcasts TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.saved_podcasts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_podcast(p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_thread public.threads%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  SELECT *
    INTO v_thread
  FROM public.threads
  WHERE id = p_thread_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  IF NOT public.is_group_member(v_thread.group_id) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_group_member');
  END IF;

  IF v_thread.status IS DISTINCT FROM 'closed' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'thread_not_closed');
  END IF;

  INSERT INTO public.saved_podcasts (user_id, thread_id)
  VALUES (v_user, p_thread_id)
  ON CONFLICT (user_id, thread_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'thread_id', p_thread_id,
    'saved_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unsave_podcast(p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  DELETE FROM public.saved_podcasts
  WHERE user_id = v_user
    AND thread_id = p_thread_id;

  RETURN jsonb_build_object('success', true, 'thread_id', p_thread_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_podcast(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unsave_podcast(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_podcast(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unsave_podcast(uuid) TO authenticated;
