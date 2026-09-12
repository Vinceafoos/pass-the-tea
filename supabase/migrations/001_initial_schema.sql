-- Core relay schema. Claim assignment is intentionally not writable by clients.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.group_members (
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE public.threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  thread_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  current_message_id uuid,
  last_claimed_by uuid REFERENCES public.profiles (id),
  consecutive_claims integer NOT NULL DEFAULT 0 CHECK (consecutive_claims >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, thread_date)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.threads (id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles (id),
  audio_path text NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  responded_to_message_id uuid REFERENCES public.messages (id),
  claimed_by uuid REFERENCES public.profiles (id),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, sequence_number)
);

ALTER TABLE public.threads
  ADD CONSTRAINT threads_current_message_id_fkey
  FOREIGN KEY (current_message_id)
  REFERENCES public.messages (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX messages_thread_id_idx ON public.messages (thread_id);
CREATE INDEX messages_claimed_by_idx ON public.messages (claimed_by);
CREATE INDEX group_members_user_id_idx ON public.group_members (user_id);
CREATE INDEX threads_group_id_idx ON public.threads (group_id);

-- Avoid recursive RLS by resolving membership with a security definer helper.
CREATE OR REPLACE FUNCTION public.user_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_id
  FROM public.group_members
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      split_part(NEW.email, '@', 1),
      'friend'
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_self_or_groupmates"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT gm.user_id
      FROM public.group_members gm
      WHERE gm.group_id IN (SELECT public.user_group_ids())
    )
  );

CREATE POLICY "profiles_update_self"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "groups_select_member"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(id));

CREATE POLICY "group_members_select_same_groups"
  ON public.group_members
  FOR SELECT
  TO authenticated
  USING (group_id IN (SELECT public.user_group_ids()));

CREATE POLICY "threads_select_member"
  ON public.threads
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

-- Clients may read messages in their groups, but cannot insert/update/delete.
-- claimed_by is assigned only via claim_message().
CREATE POLICY "messages_select_member"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.threads t
      WHERE t.id = messages.thread_id
        AND public.is_group_member(t.group_id)
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

ALTER TABLE public.threads REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;

GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT SELECT ON TABLE
  public.profiles,
  public.groups,
  public.group_members,
  public.threads,
  public.messages
TO authenticated;
GRANT UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE
  public.profiles,
  public.groups,
  public.group_members,
  public.threads,
  public.messages
TO service_role;

-- Claim/response writes go through SECURITY DEFINER RPCs only.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.threads FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.groups FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.group_members FROM anon, authenticated;
REVOKE INSERT, DELETE ON TABLE public.profiles FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.user_group_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated;
