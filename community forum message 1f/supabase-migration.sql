-- ===== Community Forum - Supabase Migration =====
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)

-- ===== 1. Users Table =====
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  anonymous_id TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 2. DM Messages Table =====
CREATE TABLE IF NOT EXISTS public.dm_messages (
  id TEXT PRIMARY KEY DEFAULT '',
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_sender ON public.dm_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_receiver ON public.dm_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_pair ON public.dm_messages(sender_id, receiver_id);

-- ===== 3. Posts Table =====
CREATE TABLE IF NOT EXISTS public.posts (
  id TEXT PRIMARY KEY,
  anonymous_id TEXT NOT NULL,
  color TEXT NOT NULL,
  text TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  likes TEXT[] DEFAULT '{}',
  dislikes TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON public.posts(created_at DESC);

-- ===== 4. Comments Table =====
CREATE TABLE IF NOT EXISTS public.comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  anonymous_id TEXT NOT NULL,
  color TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  likes TEXT[] DEFAULT '{}',
  dislikes TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON public.comments(post_id);

-- ===== 5. Row Level Security =====
-- Since this is an anonymous app, we use permissive policies

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Users: anyone can read/insert; update only your own
CREATE POLICY "Users are public" ON public.users FOR SELECT USING (true);
CREATE POLICY "Anyone can join" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own data" ON public.users FOR UPDATE USING (true);

-- DM Messages: anyone can read/insert
CREATE POLICY "Messages are readable" ON public.dm_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can send" ON public.dm_messages FOR INSERT WITH CHECK (true);

-- Posts: anyone can read/insert/update
CREATE POLICY "Posts are public" ON public.posts FOR SELECT USING (true);
CREATE POLICY "Anyone can post" ON public.posts FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update posts" ON public.posts FOR UPDATE USING (true);

-- Comments: anyone can read/insert/update
CREATE POLICY "Comments are public" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Anyone can comment" ON public.comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update comments" ON public.comments FOR UPDATE USING (true);

-- ===== 6. Enable Realtime =====
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.dm_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.comments;
