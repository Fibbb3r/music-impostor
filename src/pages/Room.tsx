import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Users, Play, AlertCircle, RefreshCw, ChevronRight, Music, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Room = {
  id: string;
  code: string;
  status: 'lobby' | 'voting' | 'results';
  admin_id: string;
  current_result_index: number;
};

type Player = {
  id: string;
  name: string;
  is_impostor: boolean;
  target_player_id: string | null;
};

type Vote = {
  id: string;
  song_index: number;
  voter_id: string;
  voted_for_id: string;
  is_impostor_guess: boolean;
  impostor_target_guess_id: string | null;
};

type VoteState = {
  voted_for_id: string;
  is_impostor_guess: boolean;
  impostor_target_guess_id: string | null;
};

export default function Room() {
  const navigate = useNavigate();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // Local state for voting
  const [myVotes, setMyVotes] = useState<Record<number, VoteState>>({});

  const playerId = localStorage.getItem('playerId');

  useEffect(() => {
    if (!playerId) {
      navigate('/');
      return;
    }

    const fetchRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .select('*')
          .eq('code', 'GLOBAL')
          .single();

        if (roomError) throw roomError;
        setRoom(roomData);

        const { data: playersData, error: playersError } = await supabase
          .from('players')
          .select('*')
          .eq('room_id', roomData.id);

        if (playersError) throw playersError;
        setPlayers(playersData || []);

        const me = playersData?.find(p => p.id === playerId);
        if (!me) {
          navigate('/');
          return;
        }
        setCurrentPlayer(me);

        // Fetch existing votes for this player
        const { data: votesData } = await supabase
          .from('votes')
          .select('*')
          .eq('room_id', roomData.id)
          .eq('voter_id', playerId);

        if (votesData) {
          const voteMap: Record<number, VoteState> = {};
          votesData.forEach(v => {
            voteMap[v.song_index] = {
              voted_for_id: v.voted_for_id,
              is_impostor_guess: v.is_impostor_guess,
              impostor_target_guess_id: v.impostor_target_guess_id
            };
          });
          setMyVotes(voteMap);
        }

        // Fetch all votes if admin or in results phase
        if (roomData.status === 'results' || me.id === roomData.admin_id) {
          const { data: allVotes } = await supabase.from('votes').select('*').eq('room_id', roomData.id);
          if (allVotes) setVotes(allVotes);
        }

        setLoading(false);

        // Subscriptions
        const sub = supabase.channel(`game-${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomData.id}` }, (payload) => {
            const newRoom = payload.new as Room;
            setRoom(newRoom);
            if (newRoom.status === 'lobby') {
              setMyVotes({});
            }
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async (payload) => {
            if (payload.eventType === 'DELETE') {
              const deletedId = payload.old.id;
              if (deletedId === playerId) {
                setError('Zostałeś wyrzucony z gry przez Admina.');
                localStorage.removeItem('playerId');
              } else {
                setPlayers(prev => {
                  const p = prev.find(x => x.id === deletedId);
                  if (p) {
                    setToast(`Gracz ${p.name} został wyrzucony.`);
                    setTimeout(() => setToast(null), 3000);
                  }
                  return prev;
                });
              }
            } else if (payload.eventType === 'INSERT') {
              const newPlayer = payload.new as Player;
              if (newPlayer.id !== playerId) {
                setToast(`Do gry dołączył(a): ${newPlayer.name}`);
                setTimeout(() => setToast(null), 3000);
              }
            }

            const { data } = await supabase.from('players').select('*').eq('room_id', roomData.id);
            if (data) {
              setPlayers(data);
              setCurrentPlayer(data.find(p => p.id === playerId) || null);
            }
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, async () => {
            const { data } = await supabase.from('votes').select('*').eq('room_id', roomData.id);
            if (data) setVotes(data);
          })
          .subscribe();

        return () => {
          supabase.removeChannel(sub);
        };
      } catch (err) {
        console.error('Room error:', err);
        const e = err as { message?: string; details?: string; hint?: string };
        setError(e.message || e.details || e.hint || JSON.stringify(e) || 'Nie udało się załadować pokoju.');
        setLoading(false);
      }
    };

    fetchRoom();
  }, [playerId, navigate]);

  const handleStartRound = async () => {
    if (!room || players.length < 3) return;

    // Assign Impostor logic
    const playersList = [...players];
    const impostorIndex = Math.floor(Math.random() * playersList.length);

    let targetIndex = Math.floor(Math.random() * playersList.length);
    while (targetIndex === impostorIndex) {
      targetIndex = Math.floor(Math.random() * playersList.length);
    }

    const updates = playersList.map((p, index) => {
      const isImpostor = index === impostorIndex;
      const targetPlayerId = isImpostor ? playersList[targetIndex].id : p.id;

      return supabase
        .from('players')
        .update({ is_impostor: isImpostor, target_player_id: targetPlayerId })
        .eq('id', p.id);
    });

    await Promise.all(updates);

    // Update room status
    await supabase
      .from('rooms')
      .update({ status: 'voting', current_result_index: 1 })
      .eq('id', room.id);
  };

  const handleVoteChange = async (songIndex: number, field: keyof VoteState, value: string | boolean) => {
    if (!room || !currentPlayer) return;

    setMyVotes(prev => {
      const current = prev[songIndex] || { voted_for_id: '', is_impostor_guess: false, impostor_target_guess_id: null };
      const updated = { ...current, [field]: value };

      // Clear target guess if they uncheck impostor
      if (field === 'is_impostor_guess' && !value) {
        updated.impostor_target_guess_id = null;
      }

      const nextState = { ...prev };

      // Jeżeli zaznaczamy kogoś jako impostora, to odznaczamy to we wszystkich INNYCH nutach
      if (field === 'is_impostor_guess' && value === true) {
        Object.keys(nextState).forEach(k => {
          const idx = parseInt(k);
          if (idx !== songIndex && nextState[idx].is_impostor_guess) {
            nextState[idx] = { ...nextState[idx], is_impostor_guess: false, impostor_target_guess_id: null };
            updateVoteInDB(idx, nextState[idx]); // Update DB for the removed guess
          }
        });
      }

      nextState[songIndex] = updated;
      updateVoteInDB(songIndex, updated);

      return nextState;
    });
  };

  const updateVoteInDB = async (songIndex: number, voteState: VoteState) => {
    if (!room || !currentPlayer || !voteState.voted_for_id) return;

    const { data: existing } = await supabase
      .from('votes')
      .select('id')
      .eq('song_index', songIndex)
      .eq('voter_id', currentPlayer.id)
      .single();

    if (existing) {
      await supabase
        .from('votes')
        .update({
          voted_for_id: voteState.voted_for_id,
          is_impostor_guess: voteState.is_impostor_guess,
          impostor_target_guess_id: voteState.impostor_target_guess_id
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('votes')
        .insert([{
          room_id: room.id,
          song_index: songIndex,
          voter_id: currentPlayer.id,
          voted_for_id: voteState.voted_for_id,
          is_impostor_guess: voteState.is_impostor_guess,
          impostor_target_guess_id: voteState.impostor_target_guess_id
        }]);
    }
  };

  const showResults = async () => {
    if (!room) return;
    await supabase
      .from('rooms')
      .update({ status: 'results', current_result_index: 1 })
      .eq('id', room.id);
  };

  const nextResult = async () => {
    if (!room) return;
    if (room.current_result_index < players.length) {
      await supabase
        .from('rooms')
        .update({ current_result_index: room.current_result_index + 1 })
        .eq('id', room.id);
    }
  };

  const newRound = async () => {
    if (!room) return;

    // Reset votes
    await supabase.from('votes').delete().eq('room_id', room.id);

    // Reset room
    await supabase
      .from('rooms')
      .update({ status: 'lobby', current_result_index: 1 })
      .eq('id', room.id);

    setMyVotes({});
  };

  const kickPlayer = async (id: string) => {
    if (!room || room.admin_id !== currentPlayer?.id) return;
    await supabase.from('players').delete().eq('id', id);
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-fuchsia-500">Ładowanie...</div>;
  }

  if (error || !room || !currentPlayer) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-panel p-8 rounded-2xl text-center shadow-2xl border border-red-500/20 bg-slate-900/80 backdrop-blur-xl">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <p className="text-white text-xl font-medium mb-8">{error || 'Błąd pokoju'}</p>
          <button onClick={() => navigate('/')} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors font-semibold shadow-lg">Wróć do ekranu głównego</button>
        </div>
      </div>
    );
  }

  const isAdmin = room.admin_id === currentPlayer.id;

  // Who does the current player impersonate?
  const myTargetPlayer = currentPlayer.target_player_id
    ? players.find(p => p.id === currentPlayer.target_player_id)
    : currentPlayer;

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center glass-panel p-4 rounded-2xl">
          <div>
            <h2 className="text-sm text-slate-400 uppercase tracking-wider font-semibold">Status</h2>
            <div className="text-xl font-bold text-white mt-1">
              {room.status === 'lobby' && 'Poczekalnia'}
              {room.status === 'voting' && <span className="text-blue-400">Głosowanie</span>}
              {room.status === 'results' && <span className="text-fuchsia-400">Wyniki</span>}
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-sm text-slate-400 uppercase tracking-wider font-semibold">Twój nick</h2>
            <div className="text-xl font-bold text-white mt-1">
              {currentPlayer.name}
              {isAdmin && <span className="text-xs bg-fuchsia-500/20 text-fuchsia-300 px-2 py-1 rounded-full ml-2 align-middle">ADMIN</span>}
            </div>
          </div>
        </div>

        {/* --- LOBBY PHASE --- */}
        {room.status === 'lobby' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid md:grid-cols-2 gap-6">
            <div className="glass-panel p-6 rounded-2xl">
              <div className="flex items-center gap-3 mb-6">
                <Users className="w-6 h-6 text-blue-400" />
                <h3 className="text-xl font-semibold">Gracze w lobby ({players.length})</h3>
              </div>
              <ul className="space-y-3">
                <AnimatePresence>
                  {players.map(p => (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex justify-between items-center"
                    >
                      <span className="font-medium">{p.name}</span>
                      <div className="flex items-center gap-2">
                        {p.id === room.admin_id && <span className="text-xs text-fuchsia-400 font-bold uppercase">Admin</span>}
                        {isAdmin && p.id !== currentPlayer.id && (
                          <button onClick={() => kickPlayer(p.id)} className="text-red-400 hover:text-red-300 text-xs px-3 py-1 bg-red-400/10 rounded-lg transition-colors font-medium">Wyrzuć</button>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>

            <div className="flex flex-col justify-center">
              {isAdmin ? (
                <div className="glass-panel p-8 rounded-2xl text-center">
                  <h3 className="text-2xl font-bold mb-4">Wszyscy gotowi?</h3>
                  <p className="text-slate-400 mb-8">Pamiętajcie, gra wymaga co najmniej 3 osób, żeby miała sens.</p>
                  <button
                    onClick={handleStartRound}
                    disabled={players.length < 3}
                    className="w-full bg-gradient-to-r from-fuchsia-600 to-blue-600 hover:from-fuchsia-500 hover:to-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-fuchsia-500/20"
                  >
                    <Play className="w-6 h-6" />
                    Rozpocznij RUNDĘ
                  </button>
                  {players.length < 3 && <p className="text-red-400 text-sm mt-3">Brakuje jeszcze {3 - players.length} graczy.</p>}
                </div>
              ) : (
                <div className="glass-panel p-8 rounded-2xl text-center flex flex-col items-center justify-center h-full">
                  <div className="w-16 h-16 border-4 border-fuchsia-500/30 border-t-fuchsia-500 rounded-full animate-spin mb-6"></div>
                  <h3 className="text-xl font-bold">Czekamy na admina...</h3>
                  <p className="text-slate-400 mt-2">Gra za chwilę się rozpocznie.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* --- VOTING PHASE --- */}
        {room.status === 'voting' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">

            {/* Rola gracza */}
            <div className={`p-6 rounded-2xl border ${currentPlayer.is_impostor ? 'bg-red-900/20 border-red-500/50 shadow-[0_0_40px_rgba(239,68,68,0.15)]' : 'bg-blue-900/20 border-blue-500/50 shadow-[0_0_40px_rgba(59,130,246,0.15)]'} text-center transition-all`}>
              {currentPlayer.is_impostor ? (
                <>
                  <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-3" />
                  <h3 className="text-2xl font-bold text-red-400">Jesteś Impostorem!</h3>
                  <p className="text-lg mt-2">Masz dodać piosenkę na stronie podszywając się pod: <span className="font-bold text-white text-xl ml-1">{myTargetPlayer?.name}</span></p>
                </>
              ) : (
                <>
                  <Music className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                  <h3 className="text-2xl font-bold text-blue-400">Grasz jako Ty</h3>
                  <p className="text-lg mt-2">Dodaj piosenkę na stronie pod swoim nickiem: <span className="font-bold text-white text-xl ml-1">{currentPlayer.name}</span></p>
                </>
              )}
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Formularz Głosowania */}
              <div className="md:col-span-2 glass-panel p-6 rounded-2xl">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <Music className="w-5 h-5 text-fuchsia-400" />
                  Głosowanie na nutki
                </h3>
                <p className="text-slate-400 mb-6 text-sm">Pamiętaj! Kiedy leci piosenka, którą TY dodawałeś - zaznacz w niej siebie!</p>

                <div className="space-y-6">
                  {players.map((_, i) => {
                    const songIndex = i + 1;
                    const currentVote = myVotes[songIndex];

                    return (
                      <div key={songIndex} className="bg-slate-800/30 p-5 rounded-xl border border-slate-700/50 flex flex-col gap-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          <span className="font-bold text-lg min-w-[80px] text-fuchsia-200">Nuta {songIndex}</span>
                          <select
                            value={currentVote?.voted_for_id || ''}
                            onChange={(e) => handleVoteChange(songIndex, 'voted_for_id', e.target.value)}
                            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-fuchsia-500 outline-none transition-all"
                          >
                            <option value="" disabled>Wybierz kto to dodał...</option>
                            {players.map(p => (
                              <option key={p.id} value={p.id}>{p.name} {p.id === currentPlayer.id ? '(Ja)' : ''}</option>
                            ))}
                          </select>
                        </div>

                        {/* Opcje Impostora (tylko gdy głosujemy na kogoś innego i sami NIE JESTEŚMY impostorem) */}
                        {!currentPlayer.is_impostor && currentVote?.voted_for_id && currentVote.voted_for_id !== currentPlayer.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="sm:ml-[96px] p-4 bg-slate-900/80 rounded-xl border border-red-500/20 shadow-inner"
                          >
                            <label className="flex items-center gap-3 cursor-pointer group w-max">
                              <input
                                type="checkbox"
                                checked={currentVote.is_impostor_guess || false}
                                onChange={(e) => handleVoteChange(songIndex, 'is_impostor_guess', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 text-red-500 focus:ring-red-500 bg-slate-800 cursor-pointer"
                              />
                              <span className="text-red-400 font-semibold group-hover:text-red-300 transition-colors">Myślę, że to Impostor!</span>
                            </label>

                            <AnimatePresence>
                              {currentVote.is_impostor_guess && (
                                <motion.div
                                  initial={{ opacity: 0, marginTop: 0 }}
                                  animate={{ opacity: 1, marginTop: 12 }}
                                  exit={{ opacity: 0, marginTop: 0 }}
                                  className="flex flex-col sm:flex-row sm:items-center gap-3 pt-3 border-t border-red-500/10"
                                >
                                  <span className="text-sm text-slate-400 min-w-max">Pod kogo się podszywa?</span>
                                  <select
                                    value={currentVote?.impostor_target_guess_id || ''}
                                    onChange={(e) => handleVoteChange(songIndex, 'impostor_target_guess_id', e.target.value)}
                                    className="flex-1 bg-slate-800 border border-red-500/40 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-red-500 outline-none text-sm transition-all"
                                  >
                                    <option value="" disabled>Wybierz ofiarę...</option>
                                    {players.filter(p => p.id !== currentVote.voted_for_id).map(p => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Panel Admina (tylko w fazie voting) */}
              {isAdmin && (
                <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-max sticky top-6">
                  <div>
                    <h3 className="text-xl font-bold mb-2 text-blue-400">Panel Admina</h3>
                    <p className="text-slate-400 text-sm">Gdy wszystkie piosenki polecą i każdy odda głosy, przejdź do wyników.</p>
                  </div>
                  <button
                    onClick={showResults}
                    className="w-full mt-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-500/20 flex justify-center items-center gap-2"
                  >
                    Pokaż wyniki <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* --- RESULTS PHASE --- */}
        {room.status === 'results' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

            <div className="glass-panel p-8 rounded-2xl text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-fuchsia-500 to-blue-500"></div>
              <h2 className="text-4xl font-black mb-8 text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">Wyniki - Nuta {room.current_result_index}</h2>

              {/* Znajdź kto zaznaczył samego siebie dla tej nuty (prawdziwy autor) */}
              {(() => {
                const songVotes = votes.filter(v => v.song_index === room.current_result_index);
                const trueAuthorVote = songVotes.find(v => v.voter_id === v.voted_for_id);
                const trueAuthor = trueAuthorVote ? players.find(p => p.id === trueAuthorVote.voter_id) : null;

                return (
                  <div className="mb-10">
                    <h4 className="text-slate-400 uppercase tracking-widest text-sm font-semibold mb-4">Piosenkę dodał:</h4>
                    {trueAuthor ? (
                      <div className="inline-flex flex-col items-center bg-slate-800/80 border border-fuchsia-500/30 px-12 py-6 rounded-3xl shadow-[0_0_40px_rgba(217,70,239,0.1)]">
                        <span className="text-4xl font-black text-white tracking-tight">{trueAuthor.name}</span>
                        {trueAuthor.is_impostor && (
                          <div className="mt-4 flex items-center gap-2 text-sm font-semibold bg-red-500/10 text-red-400 py-1.5 px-4 rounded-full border border-red-500/20">
                            <ShieldAlert className="w-4 h-4" />
                            Impostor (udawał: <span className="text-white">{players.find(p => p.id === trueAuthor.target_player_id)?.name}</span>)
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="inline-flex items-center bg-slate-800/50 border border-slate-700 px-8 py-5 rounded-2xl">
                        <span className="text-lg text-slate-400">Nikt się nie przyznał! (Brak głosu na siebie)</span>
                      </div>
                    )}

                    {/* Kto jak głosował */}
                    <div className="mt-12 text-left bg-slate-900/50 p-6 md:p-8 rounded-3xl border border-slate-700/50">
                      <h4 className="text-slate-400 uppercase text-xs font-semibold mb-6 flex items-center gap-2">
                        <Users className="w-4 h-4" /> Kto jak obstawiał:
                      </h4>
                      <div className="space-y-4">
                        {players.map(p => {
                          const playerVote = songVotes.find(v => v.voter_id === p.id);
                          const votedFor = playerVote ? players.find(x => x.id === playerVote.voted_for_id) : null;
                          const isSelfVote = playerVote?.voter_id === playerVote?.voted_for_id;
                          
                          // Check if they guessed impostor correctly
                          const guessedImpostorCorrectly = 
                            trueAuthor?.is_impostor && 
                            playerVote?.voted_for_id === trueAuthor.id && 
                            playerVote?.is_impostor_guess && 
                            playerVote?.impostor_target_guess_id === trueAuthor.target_player_id;
                            
                          const guessedOnlyImpostorRole = 
                            trueAuthor?.is_impostor && 
                            playerVote?.voted_for_id === trueAuthor.id && 
                            playerVote?.is_impostor_guess && 
                            !guessedImpostorCorrectly;

                          return (
                            <div key={p.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-800/40 p-5 rounded-2xl border border-slate-700/30">
                              
                              {/* Left side: Voter */}
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-slate-300 text-lg shadow-inner border border-slate-600/50">
                                  {p.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-semibold text-slate-200 text-lg">{p.name}</span>
                              </div>
                              
                              {/* Right side: Guess */}
                              <div className="flex flex-col md:items-end gap-2">
                                {isSelfVote ? (
                                  <div className="bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20 px-5 py-2 rounded-full font-bold text-sm w-max self-start md:self-auto">
                                    To moja nuta!
                                  </div>
                                ) : votedFor ? (
                                  <div className="flex items-center gap-2 self-start md:self-auto">
                                    <span className="text-slate-400 text-sm">obstawia:</span>
                                    <span className="text-blue-300 font-bold text-lg">{votedFor.name}</span>
                                  </div>
                                ) : (
                                  <span className="text-slate-500 italic text-sm self-start md:self-auto">Brak głosu</span>
                                )}
                                
                                {/* Impostor Guess Info */}
                                {playerVote?.is_impostor_guess && !isSelfVote && (
                                  <div className="flex flex-wrap md:justify-end gap-2 mt-1">
                                    <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                                      <ShieldAlert className="w-3.5 h-3.5" />
                                      + to Impostor (jako {players.find(x => x.id === playerVote.impostor_target_guess_id)?.name || '?'})
                                    </span>
                                    
                                    {guessedImpostorCorrectly && (
                                      <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-3 py-1.5 rounded-full font-bold flex items-center gap-1">
                                        ✓ IDEALNY TRAF
                                      </span>
                                    )}
                                    {guessedOnlyImpostorRole && (
                                      <span className="text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 px-3 py-1.5 rounded-full font-bold flex items-center gap-1">
                                        ✓ WYKRYŁ IMPOSTORA
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Admin controls */}
              {isAdmin && (
                <div className="mt-10 pt-8 border-t border-slate-700/50 flex justify-center gap-4">
                  {room.current_result_index < players.length ? (
                    <button
                      onClick={nextResult}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-colors shadow-lg shadow-blue-500/20 text-lg"
                    >
                      Następna Nuta <ChevronRight className="w-6 h-6" />
                    </button>
                  ) : (
                    <button
                      onClick={newRound}
                      className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-colors shadow-lg shadow-fuchsia-500/20 text-lg"
                    >
                      <RefreshCw className="w-6 h-6" /> Rozpocznij Nową Rundę
                    </button>
                  )}
                </div>
              )}
            </div>

            {!isAdmin && (
              <div className="text-center text-slate-400 text-sm mt-4 animate-pulse">
                Poczekaj aż Admin przełączy wynik...
              </div>
            )}
          </motion.div>
        )}

      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-6 left-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-[0_10px_40px_rgba(217,70,239,0.3)] border border-fuchsia-500/30 z-50 flex items-center gap-3 whitespace-nowrap"
          >
            <AlertCircle className="w-5 h-5 text-fuchsia-400" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
