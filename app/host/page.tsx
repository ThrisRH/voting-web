"use client";

import { useState, useEffect } from "react";
import { 
  Trophy, 
  Timer, 
  RefreshCw, 
  Play, 
  Pause, 
  Settings, 
  X,
  Award,
  Lock,
  ArrowRight,
  Users,
  AlertCircle,
  LogOut,
  ChevronRight
} from "lucide-react";
import confetti from "canvas-confetti";
import { db } from "../../lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";

interface Team {
  id: string;
  name: string;
  votes: number;
}

const ADMIN_PASSWORD = "123456";

export default function HostPage() {
  // Data States
  const [duration, setDuration] = useState<number>(300);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamNamesConfig, setTeamNamesConfig] = useState<string[]>([]);
  const [totalVotes, setTotalVotes] = useState<number>(0);
  
  // Timer States
  const [timeLeft, setTimeLeft] = useState<number>(300);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [pausedTimeLeft, setPausedTimeLeft] = useState<number>(300);

  // Authorization & Mode States
  const [votingStarted, setVotingStarted] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [passwordError, setPasswordError] = useState<boolean>(false);

  // UI States
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confettiFired, setConfettiFired] = useState<boolean>(false);

  // Check host authentication on mount
  useEffect(() => {
    const hostFlag = sessionStorage.getItem("voting_app_is_host") === "true";
    setIsHost(hostFlag);

    async function fetchConfig() {
      try {
        const configRes = await fetch("/teams.json");
        if (configRes.ok) {
          const config = await configRes.json();
          setDuration(config.votingDurationSeconds || 300);
          setTeamNamesConfig(config.teams || []);
        }
      } catch (err) {
        console.error("Config fetch error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchConfig();
  }, []);

  // Listen to Firestore changes in real-time
  useEffect(() => {
    if (loading || teamNamesConfig.length === 0) return;

    const docRef = doc(db, "sessions", "voting_session");
    
    const unsubscribe = onSnapshot(
      docRef, 
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setVotingStarted(data.votingStarted || false);
          setTimerRunning(data.timerRunning || false);
          setEndTime(data.endTime || null);
          setPausedTimeLeft(data.pausedTimeLeft !== undefined ? data.pausedTimeLeft : duration);
          
          const votesMap = data.votes || {};
          const updatedTeams = teamNamesConfig.map((name, idx) => {
            const id = `team-${idx + 1}`;
            return {
              id,
              name,
              votes: votesMap[id] || 0
            };
          });
          
          setTeams(updatedTeams);
          const total = updatedTeams.reduce((sum, team) => sum + team.votes, 0);
          setTotalVotes(total);
        }
      },
      (error) => {
        console.error("Firestore listening error:", error);
      }
    );

    return unsubscribe;
  }, [loading, teamNamesConfig, duration]);

  // Local Timer countdown
  useEffect(() => {
    if (!endTime || !timerRunning || !votingStarted) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diffSeconds = Math.max(0, Math.floor((endTime - now) / 1000));
      setTimeLeft(diffSeconds);

      if (diffSeconds <= 0) {
        setTimerRunning(false);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [endTime, timerRunning, votingStarted]);

  // Update timer display when paused
  useEffect(() => {
    if (!timerRunning) {
      setTimeLeft(pausedTimeLeft);
    }
  }, [timerRunning, pausedTimeLeft]);

  // Confetti when voting ends
  useEffect(() => {
    if (votingStarted && timeLeft === 0 && totalVotes > 0 && !confettiFired) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      setConfettiFired(true);
    } else if (timeLeft > 0) {
      setConfettiFired(false);
    }
  }, [timeLeft, totalVotes, confettiFired, votingStarted]);

  // Helper to trigger host PUT actions
  async function sendHostAction(action: string, extraData: Record<string, any> = {}) {
    setErrorMessage(null);
    try {
      const res = await fetch("/api/voting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          password: ADMIN_PASSWORD,
          ...extraData
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        setErrorMessage(errorData.error || "Action failed!");
      }
    } catch (err) {
      console.error("Host action error:", err);
      setErrorMessage("Network request failed!");
    }
  }

  // Handle Host Login
  const handleHostLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      setIsHost(true);
      sessionStorage.setItem("voting_app_is_host", "true");
      setPasswordError(false);
      setPasswordInput("");
    } else {
      setPasswordError(true);
    }
  };

  // Handle Host Sign Out
  const handleHostLogout = () => {
    setIsHost(false);
    sessionStorage.removeItem("voting_app_is_host");
  };

  // Helper calculation functions
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getPercentage = (votes: number) => {
    if (totalVotes === 0) return 0;
    return Math.round((votes / totalVotes) * 100);
  };

  const getWinner = () => {
    if (totalVotes === 0) return null;
    return [...teams].sort((a, b) => b.votes - a.votes)[0];
  };

  const winner = getWinner();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white text-sm">
        <RefreshCw className="w-5 h-5 animate-spin text-[#369d5c] mr-2" /> Loading Host Dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center p-2 sm:p-4 text-slate-800 font-sans">
      
      {/* Banner Section */}
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-t-[4px] overflow-hidden shadow-sm">
        <img 
          src="/banner.jpg" 
          alt="Banner" 
          className="w-full h-auto object-contain block"
        />
      </div>

      {/* Main Container */}
      <div className="w-full max-w-2xl bg-white border-x border-b border-slate-200 rounded-b-[4px] shadow-sm flex flex-col">
        
        {/* Header Bar */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white rounded-b-none">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#369d5c]" />
            <h1 className="font-bold text-sm sm:text-base">Host Control Dashboard</h1>
          </div>
          {isHost && (
            <button
              onClick={handleHostLogout}
              className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-[4px] transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Exit Host Mode
            </button>
          )}
        </div>

        {/* HOST AUTHENTICATION SCREEN */}
        {!isHost ? (
          <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-12 h-12 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center text-slate-700">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Host Access Verification</h2>
              <p className="text-xs text-slate-500 mt-1">Please enter the host password to manage the voting session.</p>
            </div>

            <form onSubmit={handleHostLogin} className="w-full max-w-xs flex flex-col gap-3 mt-2">
              {passwordError && (
                <div className="p-2 bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold rounded-[4px]">
                  Incorrect host password!
                </div>
              )}

              <div className="relative flex items-center">
                <div className="absolute left-3 inset-y-0 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter Host Password..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-[4px] text-xs font-medium focus:outline-none focus:border-[#369d5c] focus:bg-white text-slate-700"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 px-4 bg-[#369d5c] hover:bg-[#2c854e] text-white font-bold text-xs rounded-[4px] transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                Access Control Panel <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        ) : (
          
          /* HOST CONTROL PANEL (AUTHENTICATED) */
          <div className="p-4 sm:p-6 flex flex-col gap-5">

            {/* Error banner */}
            {errorMessage && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold rounded-[4px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Status Summary Cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-[4px] flex flex-col gap-1 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400">Session Status</span>
                <span className={`text-xs font-bold ${votingStarted ? "text-[#369d5c]" : "text-amber-600"}`}>
                  {votingStarted ? (timerRunning ? "Live Voting" : "Voting Paused") : "Not Started"}
                </span>
              </div>
              
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-[4px] flex flex-col gap-1 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400">Time Remaining</span>
                <span className="text-xs font-extrabold text-slate-800 font-mono flex items-center justify-center gap-1">
                  <Timer className="w-3.5 h-3.5 text-[#369d5c]" />
                  {formatTime(timeLeft)}
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-[4px] flex flex-col gap-1 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400">Total Votes</span>
                <span className="text-xs font-extrabold text-slate-800 flex items-center justify-center gap-1">
                  <Users className="w-3.5 h-3.5 text-[#369d5c]" />
                  {totalVotes.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Main Action Bar */}
            <div className="p-4 bg-slate-900 text-white rounded-[4px] flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Settings className="w-4 h-4 text-[#369d5c]" /> Session Operations
                </span>
                {!votingStarted ? (
                  <button 
                    onClick={() => sendHostAction("START", { durationSeconds: duration })}
                    className="px-3 py-1.5 bg-[#369d5c] hover:bg-[#2c854e] text-white font-bold text-xs rounded-[4px] cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" /> Activate Voting
                  </button>
                ) : (
                  <button 
                    onClick={() => sendHostAction("RESET_ALL")}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-[4px] cursor-pointer flex items-center gap-1 shadow-sm"
                  >
                    <X className="w-3.5 h-3.5" /> End & Reset Session
                  </button>
                )}
              </div>

              {/* Timer Controls */}
              {votingStarted && (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button 
                    onClick={() => sendHostAction("TOGGLE_TIMER")}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-[4px] cursor-pointer border border-slate-700"
                  >
                    {timerRunning && timeLeft > 0 ? (
                      <><Pause className="w-3.5 h-3.5" /> Pause Timer</>
                    ) : (
                      <><Play className="w-3.5 h-3.5" /> Resume Timer</>
                    )}
                  </button>

                  <button 
                    onClick={() => sendHostAction("ADJUST_TIMER", { seconds: 60 })}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-[4px] cursor-pointer border border-slate-700"
                  >
                    + 1 min
                  </button>

                  <button 
                    onClick={() => sendHostAction("ADJUST_TIMER", { seconds: -60 })}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-[4px] cursor-pointer border border-slate-700"
                  >
                    - 1 min
                  </button>

                  <button 
                    onClick={() => sendHostAction("END_NOW")}
                    className="px-2.5 py-1.5 bg-rose-900/50 hover:bg-rose-900 border border-rose-700/50 text-rose-200 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    End Now (0s)
                  </button>

                  <button 
                    onClick={() => sendHostAction("RESET_VOTES")}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-[4px] cursor-pointer flex items-center gap-1 ml-auto"
                    title="Reset vote counts while keeping session active"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reset Votes Only
                  </button>
                </div>
              )}
            </div>

            {/* Victory Banner (Shown to Host when timer concludes) */}
            {votingStarted && timeLeft === 0 && totalVotes > 0 && winner && (
              <div className="p-4 bg-amber-500/10 border-2 border-amber-400 rounded-[4px] text-center flex flex-col items-center justify-center gap-1 animate-pulse">
                <Trophy className="w-8 h-8 text-amber-500" />
                <h3 className="text-xs uppercase font-extrabold tracking-wider text-amber-600">Official Winner Announced</h3>
                <p className="text-base sm:text-lg font-black text-slate-900">🏆 {winner.name} ({winner.votes} votes) 🏆</p>
              </div>
            )}

            {/* Real-time Team Results Table */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 uppercase tracking-wider pb-1 border-b border-slate-200">
                <span>Team Name</span>
                <span>Live Results</span>
              </div>

              {teams.map((team, index) => {
                const percent = getPercentage(team.votes);
                const isLeading = winner?.id === team.id && totalVotes > 0;

                return (
                  <div 
                    key={team.id}
                    className={`p-3 bg-white border rounded-[4px] flex items-center justify-between gap-3 ${
                      isLeading ? "border-amber-400 bg-amber-50/20" : "border-slate-200"
                    }`}
                  >
                    {/* Team Name */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div 
                        className="w-7 h-7 flex items-center justify-center font-bold text-xs text-white rounded-[4px] shrink-0"
                        style={{ backgroundColor: `hsl(${135 + index * 45}, 45%, 43%)` }}
                      >
                        {team.name.charAt(0)}
                      </div>
                      <span className="font-bold text-slate-800 text-xs sm:text-sm truncate">
                        {team.name}
                      </span>
                      {isLeading && (
                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-[4px]">
                          Leading
                        </span>
                      )}
                    </div>

                    {/* Progress Bar & Vote Count */}
                    <div className="flex items-center gap-3 flex-1 max-w-xs justify-end">
                      <span className="text-xs font-bold text-slate-700 shrink-0">
                        {team.votes.toLocaleString()} votes ({percent}%)
                      </span>
                      <div className="w-24 sm:w-32 bg-slate-100 h-2.5 rounded-[4px] overflow-hidden border border-slate-200/60">
                        <div 
                          className="bg-[#369d5c] h-full rounded-[4px] transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Host Note */}
            <div className="text-center text-[10px] text-slate-400 font-medium pt-2 border-t border-slate-100 flex items-center justify-center gap-1">
              <Award className="w-3.5 h-3.5 text-[#369d5c]" />
              Host Dashboard endpoint active at <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-mono">/host</code>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
