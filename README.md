# Pass the Mic

Hackathon MVP: a voice-note relay for friend groups. Each group has one active clip. The first eligible member to claim it may listen and record the next note.

The important part is the **atomic claim**. Two people can tap Claim at the same time; Postgres `SELECT … FOR UPDATE` inside `claim_message()` allows exactly one winner.

Nightly AI recap, notifications, and visual polish are out of scope for this milestone.

## Stack

Expo (SDK 57) · React Native · TypeScript · Expo Router · Supabase Auth / Postgres / Realtime / Storage

## First-time setup

### 1. App env

```bash
cp .env.example .env
```

Put the **project URL** and **anon key** (Settings → API) into `.env`. Never put the service-role key in the app.

### 2. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Authentication → Providers → Email: turn **off** “Confirm email” so hackathon accounts can sign in immediately.
3. SQL Editor: run the migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_claim_message_function.sql`
   - `supabase/migrations/003_storage_policies.sql`
4. If you use the Supabase CLI instead: `supabase db push` from this repo after `supabase link`.

### 3. Seed three users and one group

Auth users cannot be created from SQL.

1. Authentication → Users → add:
   - `alex@example.com`
   - `jamie@example.com`
   - `sam@example.com`
2. Copy each user’s UUID.
3. Confirm `public.profiles` rows exist (created by trigger).
4. Open `supabase/seed.sql`, replace the three placeholder UUIDs, run it in the SQL editor.
5. Storage → `voice-notes` (private bucket from migration) → upload any short `.m4a` to:

```text
11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.m4a
```

Without that file, claiming still works; playback of the seed clip will fail until you upload it.

To reset the race for another demo, set the seed message’s `claimed_by` / `claimed_at` back to null and `threads.last_claimed_by` / `consecutive_claims` back to null / 0 (re-running the seed block does this).

### 4. Optional SQL checks

After replacing UUIDs in `supabase/tests/test_claim_logic.sql`, run it in the SQL editor. Simultaneous race still needs two phones — see below.

## Run the app

```bash
cd ~/Projects/pass-the-mic
npm install
npx expo start
```

Scan the QR code with Expo Go, or press `i` / `a` for a simulator.

Typecheck and claim-rule unit tests:

```bash
npm run typecheck
npm test
```

## Two-device claim race

1. Device A: sign in as Alex.
2. Device B: sign in as Jamie.
3. Both open **Hackathon Friends**.
4. Both should see **New voice note** and **Claim & Listen**.
5. Tap Claim on both as close together as you can.
6. Exactly one row in `messages` should have `claimed_by`.
7. Winner: **You got it**, then Listen / Respond.
8. Loser: **Too slow** with the winner’s name, without pulling to refresh.
9. Winner can play the clip. Loser opening Listen should be blocked by the app and by Storage RLS.

## How claiming works

Clients never `update messages set claimed_by`. They call `supabase.rpc('claim_message', { p_message_id })`.

That function locks the thread row, then the message row, checks membership, current-message, 10-minute expiry, and the two-in-a-row anti-domination rule, then writes the claim.

Responses go through `create_response_message`.

## Known gaps

- No group-create UI; membership comes from seed SQL.
- Episode screen is a placeholder.
- Seed audio file must be uploaded by hand.
- Expo Go on a physical device is the easiest way to record; simulator mics vary.
- Email confirmation must be disabled (or you must confirm users) or sign-up will look like a no-op.

## Next smallest milestone

After the two-device race works: bootstrap the first clip from the app (record + upload as sequence 1) so you do not need a manual Storage upload, then add a tiny “create group / invite by email” flow.
