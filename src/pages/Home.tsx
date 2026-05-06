import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Music, ArrowRight, Key } from 'lucide-react';
import { motion } from 'framer-motion';

const GLOBAL_ROOM_CODE = 'GLOBAL';

export default function Home() {
  const [playerName, setPlayerName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return setError('Musisz podać swój nick!');
    
    setIsJoining(true);
    setError('');
    
    try {
      // Find or create global room
      let { data: roomData } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', GLOBAL_ROOM_CODE)
        .single();
        
      if (!roomData) {
        // Create if doesn't exist
        const { data: newRoom, error: createError } = await supabase
          .from('rooms')
          .insert([{ code: GLOBAL_ROOM_CODE, status: 'lobby' }])
          .select()
          .single();
          
        if (createError) throw createError;
        roomData = newRoom;
      }

      if (roomData.status !== 'lobby') {
        throw new Error('Gra już trwa! Poczekaj na koniec rundy.');
      }

      // Check if name is taken
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('room_id', roomData.id)
        .eq('name', playerName.trim())
        .single();
        
      let playerId;

      if (existingPlayer) {
        // Rejoin as the same player
        playerId = existingPlayer.id;
      } else {
        // Create new player
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .insert([{ room_id: roomData.id, name: playerName.trim() }])
          .select()
          .single();

        if (playerError) throw playerError;
        playerId = playerData.id;
      }

      // Check Admin Password
      const envPassword = import.meta.env.VITE_ADMIN_PASSWORD;
      if (adminPassword && adminPassword === envPassword) {
        // Make this player the admin
        await supabase
          .from('rooms')
          .update({ admin_id: playerId })
          .eq('id', roomData.id);
      } else if (adminPassword && adminPassword !== envPassword) {
        throw new Error('Nieprawidłowe hasło admina!');
      }

      // Save player id to local storage
      localStorage.setItem('playerId', playerId);
      
      navigate(`/room/${GLOBAL_ROOM_CODE}`);
    } catch (err) {
      console.error(err);
      const e = err as { message?: string };
      setError(e.message || 'Błąd podczas dołączania.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-fuchsia-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel w-full max-w-md p-8 rounded-2xl shadow-2xl relative z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-fuchsia-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg mb-4 rotate-3">
            <Music className="w-8 h-8 text-white -rotate-3" />
          </div>
          <h1 className="text-3xl font-bold text-center tracking-tight text-white">Music Impostor</h1>
          <p className="text-slate-400 mt-2 text-center text-sm">Dołącz do gry ze znajomymi.</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Twój nick</label>
            <input 
              type="text" 
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-fuchsia-500 focus:ring-1 focus:ring-fuchsia-500 transition-all"
              placeholder="np. Wojtek"
              maxLength={20}
              required
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Key className="w-4 h-4 text-slate-400" />
              Hasło admina (opcjonalne)
            </label>
            <input 
              type="password" 
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              placeholder="Zostaw puste jeśli jesteś graczem"
            />
          </div>

          <div className="pt-2">
            <button 
              type="submit"
              disabled={isJoining || !playerName}
              className="w-full bg-gradient-to-r from-fuchsia-600 to-blue-600 hover:from-fuchsia-500 hover:to-blue-500 text-white font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <span>Dołącz do gry</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
