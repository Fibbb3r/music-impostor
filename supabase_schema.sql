-- Pokoje
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby', -- 'lobby', 'voting', 'results'
  admin_id UUID,
  current_result_index INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Gracze
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_impostor BOOLEAN NOT NULL DEFAULT false,
  target_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(room_id, name)
);

-- Głosy
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  song_index INTEGER NOT NULL,
  voter_id UUID REFERENCES players(id) ON DELETE CASCADE,
  voted_for_id UUID REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(room_id, song_index, voter_id)
);

ALTER TABLE rooms ADD CONSTRAINT fk_admin FOREIGN KEY (admin_id) REFERENCES players(id) ON DELETE SET NULL;

-- Bezpieczeństwo i dostęp (Realtime i anonimowy dostęp)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all players" ON players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all votes" ON votes FOR ALL USING (true) WITH CHECK (true);

begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table votes;
