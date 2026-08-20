"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Trophy, 
  Timer, 
  Check, 
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
  LogOut
} from "lucide-react";
import confetti from "canvas-confetti";
import { db } from "../lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";

interface Team {
  id: string;
  name: string;
  votes: number;
}

const ADMIN_PASSWORD = "123456";

// Safe localStorage access wrappers that never throw in private/incognito modes
function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSetLocalStorage(key: string, val: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    localStorage.setItem(key, val);
  } catch (e) {
    // Ignore storage restrictions in incognito mode
  }
}

function safeRemoveLocalStorage(key: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    localStorage.removeItem(key);
  } catch (e) {
    // Ignore storage restrictions
  }
}

let memoryVoterId = "";

// Helper to get device fingerprint
function getDeviceFingerprint(): string {
  try {
    if (typeof window === "undefined") return "";
    const nav = window.navigator || ({} as Navigator);
    const screen = window.screen || ({} as Screen);
    
    const components = [
      nav.userAgent || "",
      nav.language || "",
      screen.colorDepth || 0,
      screen.width ? screen.width + "x" + screen.height : "",
      screen.availWidth ? screen.availWidth + "x" + screen.availHeight : "",
      new Date().getTimezoneOffset(),
      nav.hardwareConcurrency || 0,
      nav.platform || ""
    ];
    
    let hash = 0;
    const str = components.join("||");
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return "fp_" + Math.abs(hash).toString(36);
  } catch (e) {
    return "fp_fallback_" + Math.random().toString(36).substring(2, 8);
  }
}

export default function Home() {
  // Data States
  const [duration, setDuration] = useState<number>(300);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamNamesConfig, setTeamNamesConfig] = useState<string[]>([]);
  const [totalVotes, setTotalVotes] = useState<number>(0);
  const [clientIp, setClientIp] = useState<string>("");
  const [voterId, setVoterId] = useState<string>("");
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const pendingTeamIdRef = useRef<string | null>(null);
  
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
  const [votedTeamIds, setVotedTeamIds] = useState<string[]>([]);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confettiFired, setConfettiFired] = useState<boolean>(false);

  // Initialize voterId on client mount
  useEffect(() => {
    try {
      let id = safeGetLocalStorage("voting_voter_id");
      if (!id) {
        if (!memoryVoterId) {
          memoryVoterId = "voter_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
        }
        id = memoryVoterId;
        safeSetLocalStorage("voting_voter_id", id);
      }
      setVoterId(id);
    } catch (e) {
      setVoterId("voter_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9));
    }
  }, []);

  // Fetch initial config and check voter status once voterId is initialized
  useEffect(() => {
    if (!voterId) return;

    let isSubscribed = true;

    async function initializeClient() {
      try {
        const fp = getDeviceFingerprint();
        // 1. Fetch IP & voted status from API with cache: no-store
        const statusRes = await fetch(
          `/api/voting?voterId=${encodeURIComponent(voterId)}&fingerprint=${encodeURIComponent(fp)}`,
          { cache: "no-store" }
        ).catch(() => null);

        if (statusRes && statusRes.ok) {
          const data = await statusRes.json().catch(() => ({}));
          if (isSubscribed) {
            setClientIp(data.clientIp || "127.0.0.1");
            if (Array.isArray(data.votedTeamIds)) {
              setVotedTeamIds(data.votedTeamIds);
            } else if (data.votedTeamId) {
              setVotedTeamIds([data.votedTeamId]);
            } else {
              setVotedTeamIds([]);
            }
          }
        }

        // 2. Fetch team config names with cache: no-store
        const configRes = await fetch("/teams.json", { cache: "no-store" }).catch(() => null);
        let defaultTeams = ["Team 1", "Team 2", "Team 3", "Team 4"];
        if (configRes && configRes.ok) {
          const config = await configRes.json().catch(() => null);
          if (config) {
            setDuration(config.votingDurationSeconds || 300);
            if (Array.isArray(config.teams) && config.teams.length > 0) {
              defaultTeams = config.teams;
            }
          }
        }
        if (isSubscribed) {
          setTeamNamesConfig(defaultTeams);
        }
      } catch (err) {
        console.error("Initialization error:", err);
        if (isSubscribed) {
          setTeamNamesConfig(["Team 1", "Team 2", "Team 3", "Team 4"]);
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    }

    initializeClient();

    // Check host status in localStorage
    const hostFlag = safeGetLocalStorage("voting_app_is_host") === "true";
    setIsHost(hostFlag);

    return () => {
      isSubscribed = false;
    };
  }, [voterId]);

  // Listen to Firestore changes in real-time
  useEffect(() => {
    if (loading || !voterId) return;

    const docRef = doc(db, "sessions", "voting_session");
    
    // Subscribe to real-time changes
    const unsubscribe = onSnapshot(
      docRef, 
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setVotingStarted(data.votingStarted || false);
          setTimerRunning(data.timerRunning || false);
          setEndTime(data.endTime || null);
          setPausedTimeLeft(data.pausedTimeLeft !== undefined ? data.pausedTimeLeft : duration);
          
          // Check if session was reset: auto log out Host if reset occurred after/at Host login
          const resetTimestamp = data.resetTimestamp || 0;
          const hostLoginTime = parseInt(safeGetLocalStorage("voting_host_login_time") || "0", 10);
          if (resetTimestamp > 0 && (hostLoginTime === 0 || resetTimestamp >= hostLoginTime)) {
            setIsHost(false);
            safeRemoveLocalStorage("voting_app_is_host");
            safeRemoveLocalStorage("voting_host_login_time");
          }
          const votesMap = data.votes || {};
          const currentConfig = teamNamesConfig.length > 0 ? teamNamesConfig : ["Team 1", "Team 2", "Team 3", "Team 4"];
          const updatedTeams = currentConfig.map((name, idx) => {
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

          // Update votedTeamIds based on composite key (IP + fingerprint), voterId, and fp
          const sanitizedVoterId = voterId ? voterId.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
          const sanitizedIp = clientIp ? clientIp.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
          const fp = getDeviceFingerprint();
          const sanitizedFp = fp ? fp.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
          
          const voterKey = `ip_${sanitizedIp}_fp_${sanitizedFp}`;
          const votedDevicesMap = data.votedDevices || {};

          const getVotedList = (val: any): string[] => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            if (typeof val === "string") return [val];
            return [];
          };

          const compositeVotes = voterKey ? getVotedList(votedDevicesMap[voterKey]) : [];
          const deviceVotes = sanitizedVoterId ? getVotedList(votedDevicesMap[sanitizedVoterId]) : [];
          const fpVotes = sanitizedFp ? getVotedList(votedDevicesMap[`fp_${sanitizedFp}`]) : [];
          const currentVotedIds = Array.from(new Set([...compositeVotes, ...deviceVotes, ...fpVotes]));

          if (!pendingTeamIdRef.current) {
            setVotedTeamIds(currentVotedIds);
          }
        }
      },
      (error) => {
        console.error("Firestore listening error:", error);
      }
    );

    return unsubscribe;
  }, [loading, teamNamesConfig, duration, voterId, clientIp]);

  // Local Timer countdown for smooth display
  useEffect(() => {
    if (!endTime || !timerRunning || !votingStarted) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      
      setTimeLeft(remaining);
      
      if (remaining === 0) {
        setTimeLeft(0);
        setTimerRunning(false);
        clearInterval(interval);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [endTime, timerRunning, votingStarted]);

  // Adjust local clock when endTime or pausedTimeLeft changes
  useEffect(() => {
    if (votingStarted) {
      if (timerRunning && endTime) {
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
      } else {
        setTimeLeft(pausedTimeLeft);
      }
    } else {
      setTimeLeft(duration);
    }
  }, [endTime, timerRunning, votingStarted, pausedTimeLeft, duration]);

  // Winner Confetti Explosion
  useEffect(() => {
    if (votingStarted && timeLeft === 0 && !loading && teams.length > 0 && !confettiFired) {
      const winner = getWinner();
      if (winner && totalVotes > 0) {
        triggerWinnerConfetti();
        setConfettiFired(true);
      }
    }
    if (timeLeft > 0) {
      setConfettiFired(false);
    }
  }, [timeLeft, loading, teams, confettiFired, votingStarted]);

  const triggerWinnerConfetti = () => {
    const animationDuration = 5 * 1000;
    const animationEnd = Date.now() + animationDuration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(() => {
      const remainingTime = animationEnd - Date.now();

      if (remainingTime <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (remainingTime / animationDuration);
      const colors = ["#369d5c", "#5bc183", "#23723f", "#a7f3d0", "#ffffff"];
      
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors
      });
    }, 250);
  };

  const triggerVoteConfetti = () => {
    confetti({
      particleCount: 60,
      spread: 40,
      origin: { y: 0.8 },
      colors: ["#369d5c", "#5bc183", "#ffffff"]
    });
  };

  // Submit Vote through secure API to check device ID & IP limits (Supports Toggle / Unvote)
  const handleVote = async (teamId: string) => {
    if (isHost || !votingStarted || timeLeft === 0) return;
    if (!voterId) return;
    if (pendingTeamIdRef.current) return; // Prevent rapid double clicking

    const isAlreadyVoted = votedTeamIds.includes(teamId);
    if (!isAlreadyVoted && votedTeamIds.length >= 2) {
      setErrorMessage("Bạn đã sử dụng tối đa 2 lượt bình chọn! Vui lòng bỏ chọn một đội trước khi chọn đội mới.");
      setTimeout(() => setErrorMessage(null), 4000);
      return;
    }

    setPendingTeamId(teamId);
    pendingTeamIdRef.current = teamId;

    // Optimistic Update (Immediate visual response)
    const previousVotedIds = [...votedTeamIds];
    let nextVotedIds: string[];
    if (isAlreadyVoted) {
      nextVotedIds = votedTeamIds.filter(id => id !== teamId);
    } else {
      nextVotedIds = [...votedTeamIds, teamId];
      triggerVoteConfetti();
    }
    setVotedTeamIds(nextVotedIds);

    try {
      const fp = getDeviceFingerprint();
      const res = await fetch("/api/voting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, voterId, fingerprint: fp })
      });

      const data = await res.json();
      
      if (!res.ok) {
        // Revert optimistic update on failure
        setVotedTeamIds(previousVotedIds);
        setErrorMessage(data.error || "Có lỗi xảy ra!");
        setTimeout(() => setErrorMessage(null), 5000);
      } else if (Array.isArray(data.votedTeamIds)) {
        setVotedTeamIds(data.votedTeamIds);
      }
    } catch (err) {
      console.error(err);
      // Revert optimistic update on error
      setVotedTeamIds(previousVotedIds);
      setErrorMessage("Không thể kết nối đến máy chủ!");
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setPendingTeamId(null);
      pendingTeamIdRef.current = null;
    }
  };

  // Trigger Host PUT Actions
  const sendHostAction = async (action: string, payload: Record<string, any> = {}) => {
    try {
      await fetch("/api/voting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          password: ADMIN_PASSWORD,
          ...payload
        })
      });
    } catch (err) {
      console.error("Action error:", err);
    }
  };

  const getWinner = (): Team | null => {
    if (teams.length === 0) return null;
    return teams.reduce((max, team) => team.votes > max.votes ? team : max, teams[0]);
  };

  const getPercentage = (votes: number): number => {
    if (totalVotes === 0) return 0;
    return Math.round((votes / totalVotes) * 100);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Host Password Form Login
  const handleHostLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      setIsHost(true);
      setPasswordError(false);
      safeSetLocalStorage("voting_app_is_host", "true");
      safeSetLocalStorage("voting_host_login_time", Date.now().toString());
    } else {
      setPasswordError(true);
    }
  };

  // Victory Banner: reveals winning team to Host ONLY after timer ends
  const renderVictoryText = () => {
    if (!isHost) {
      return "Victory: (could be your team)";
    }
    
    if (!votingStarted || timeLeft > 0) {
      return "Victory: (could be your team)";
    }
    
    if (totalVotes === 0) {
      return "No votes cast";
    }

    const winner = getWinner();
    if (!winner) return "No votes cast";

    // Check for tie: find all teams with the same max vote count
    const maxVotes = winner.votes;
    const tiedTeams = teams.filter(t => t.votes === maxVotes && maxVotes > 0);

    if (tiedTeams.length > 1) {
      const names = tiedTeams.map(t => t.name).join(" & ");
      return `🤝 Hòa: ${names}`;
    }

    return `Victory: ${winner.name}`;
  };

  return (
    <div className="flex flex-col h-screen max-h-screen w-full bg-[#fcfefd] text-[#1e293b] font-sans antialiased overflow-hidden select-none relative">
      {/* Top green accent bar */}
      <div className="h-1 w-full bg-[#369d5c] shrink-0" />

      {/* ERROR TOAST */}
      {errorMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-rose-50 border border-rose-200 text-rose-600 px-4 py-2 rounded-[4px] shadow-lg z-50 flex items-center gap-2 text-xs md:text-sm animate-bounce">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span className="font-semibold">{errorMessage}</span>
        </div>
      )}

      {/* Main viewport area */}
      <main className="flex-1 flex flex-col justify-center items-center p-2 sm:p-4 md:p-6 overflow-hidden w-full max-w-2xl mx-auto">
        
        {/* Core Container Card */}
        <div className="w-full bg-white border border-[#e2e8f0] p-3 sm:p-5 md:p-8 shadow-sm rounded-[4px] flex flex-col overflow-hidden max-h-full">
          
          {/* HEADER (12px gap) */}
          <div className="flex flex-col items-center gap-[12px] w-full text-center shrink-0">
            
            {/* Event Hero Banner (Full Size - No Cropping) */}
            <div className="w-full relative rounded-[6px] overflow-hidden border border-slate-200/80 shadow-sm bg-slate-50 flex items-center justify-center shrink-0">
              <img
                src="/banner.jpg"
                alt="O.TECH Company Trip 2026 - Break The Limits, Win The Future"
                className="w-full h-auto object-contain block"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = "none";
                }}
              />
            </div>

            {/* Victory Text Banner */}
            <div className="w-full max-w-sm px-3 sm:px-4 py-1.5 bg-[#f4faf6] border border-[#369d5c]/10 text-[#369d5c] font-semibold text-xs md:text-sm rounded-[4px] flex items-center justify-center gap-1.5 animate-pulse shrink-0">
              <Trophy className="w-3.5 h-3.5 shrink-0 text-[#369d5c]" />
              <span className="tracking-wide text-center truncate">
                {renderVictoryText()}
              </span>
            </div>

            {/* Title & Status indicator */}
            <div className="flex flex-col items-center gap-[12px]">
              {/* Timer Badge */}
              {votingStarted && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-[4px]">
                  <Timer className={`w-3.5 h-3.5 ${timerRunning && timeLeft > 0 ? "text-[#369d5c] animate-spin-slow" : "text-slate-400"}`} />
                  <span className="text-xs font-semibold tracking-wider font-mono text-slate-700">
                    {timeLeft > 0 ? formatTime(timeLeft) : "Time's up"}
                  </span>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${timeLeft > 0 ? (timerRunning ? "bg-[#369d5c] animate-ping" : "bg-amber-400") : "bg-rose-500"}`} />
                </div>
              )}
            </div>

          </div>

          {/* SPACING: 20px - 32px gap between header and content card area */}
          <div className="mt-4 sm:mt-[32px] flex-1 flex flex-col gap-[12px] overflow-hidden">
            
            {loading ? (
              <div className="flex-1 flex justify-center items-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#369d5c]"></div>
              </div>
            ) : !votingStarted ? (
              
              /* CASE 1: Voting NOT STARTED Yet */
              <div className="flex-1 flex flex-col justify-center items-center text-center p-2 sm:p-4 gap-[12px]">
                
                {isHost ? (
                  /* Host waiting view */
                  <div className="flex flex-col items-center gap-[12px] max-w-sm">
                    <div className="w-12 h-12 bg-[#369d5c]/10 text-[#369d5c] rounded-[4px] flex items-center justify-center">
                      <Settings className="w-6 h-6 animate-pulse" />
                    </div>
                    <div className="flex flex-col gap-[6px]">
                      <h2 className="font-bold text-slate-800 text-base">Start Voting Session</h2>
                      <p className="text-xs text-slate-500">Click the button below to activate the voting system.</p>
                    </div>
                    <button
                      onClick={() => sendHostAction("START", { durationSeconds: duration })}
                      className="w-full mt-2 py-2.5 px-4 bg-[#369d5c] hover:bg-[#2c854e] text-white font-bold text-sm rounded-[4px] transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98 cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-white" /> Start Voting
                    </button>
                  </div>
                ) : (
                  /* Employee waiting view */
                  <div className="flex flex-col items-center gap-[12px] max-w-sm">
                    <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-[4px] border border-slate-100 flex items-center justify-center animate-bounce">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col gap-[6px]">
                      <h2 className="font-bold text-slate-700 text-sm md:text-base">Voting Session Coming Up</h2>
                      <p className="text-xs text-slate-400">Please wait for the host to start the voting session.</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-600 border border-amber-100 text-[10px] font-bold rounded-[4px] uppercase animate-pulse">
                      Waiting to Begin
                    </span>
                  </div>
                )}
                
                {/* Host authentication login form inside waiting page */}
                {!isHost && (
                  <form onSubmit={handleHostLogin} className="w-full max-w-xs mt-6 pt-4 border-t border-slate-100 flex flex-col gap-[6px]">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                      <span>Host access:</span>
                      {passwordError && <span className="text-rose-500 font-bold">Incorrect password!</span>}
                    </div>
                    <div className="flex items-center gap-[6px]">
                      <div className="relative flex-1 flex items-center">
                        <div className="absolute left-2.5 inset-y-0 flex items-center pointer-events-none text-slate-400">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                        </div>
                        <input
                          type="password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="Password..."
                          className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-[4px] text-xs focus:outline-none focus:border-[#369d5c] focus:bg-white text-slate-700 placeholder:text-slate-400 leading-normal"
                        />
                      </div>
                      <button
                        type="submit"
                        className="p-1.5 bg-slate-800 text-white rounded-[4px] hover:bg-slate-700 transition-colors cursor-pointer shrink-0"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                )}

              </div>

            ) : (
              
              /* CASE 2: Voting ACTIVE / STARTED */
              <div className="flex-1 flex flex-col gap-[12px] overflow-hidden">
                
                {/* Total count details (Shown ONLY to Host to keep voter UI clean & vote-free) */}
                {isHost && (
                  <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-1.5 text-slate-500 font-medium shrink-0">
                    <span className="flex items-center gap-1"><Settings className="w-3 h-3 text-[#369d5c]" /> Host View (Live Results):</span>
                    <span className="text-slate-800 font-bold bg-[#369d5c]/5 border border-[#369d5c]/15 px-2.5 py-0.5 rounded-[4px]">
                      {totalVotes.toLocaleString()} votes
                    </span>
                  </div>
                )}

                {/* Team Rows list (Scrollable if overflow) */}
                <div className="flex-1 overflow-y-auto pr-0.5 flex flex-col gap-[10px] sm:gap-[12px]">
                  {teams.map((team, index) => {
                    const percent = getPercentage(team.votes);
                    const isLeading = timeLeft === 0 && getWinner()?.id === team.id && totalVotes > 0;
                    const isUserSelection = votedTeamIds.includes(team.id);
                    const isMaxVotesReached = votedTeamIds.length >= 2;
                    const isPendingThisTeam = pendingTeamId === team.id;
                    const isButtonDisabled = isHost || timeLeft === 0 || !!pendingTeamId || (!isUserSelection && isMaxVotesReached);
                    
                    return (
                      <div 
                        key={team.id}
                        className={`flex items-center justify-between p-2.5 sm:p-3 bg-white border rounded-[4px] transition-all duration-200 relative overflow-hidden gap-2 ${
                          isUserSelection 
                            ? "border-[#369d5c] bg-[#369d5c]/5 ring-1 ring-[#369d5c]" 
                            : isLeading && isHost
                              ? "border-amber-300 bg-amber-50/10" 
                              : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {/* Left: Avatar + Team Name (6px gap) */}
                        <div className="flex items-center gap-[6px] sm:gap-2 min-w-0 flex-1">
                          <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center font-bold text-xs text-white rounded-[4px] shrink-0"
                               style={{ backgroundColor: `hsl(${135 + index * 45}, 45%, 43%)` }}>
                            {team.name.charAt(0)}
                          </div>
                          <span className="font-bold text-slate-800 text-xs sm:text-sm md:text-base leading-tight break-words min-w-0" title={team.name}>
                            {team.name}
                          </span>
                        </div>

                        {/* Middle: Vote representation (Host gets visual vote counts & progress bars) */}
                        {isHost && (
                          <div className="flex items-center gap-2 sm:gap-3 px-1 sm:px-3 flex-1 max-w-[140px] sm:max-w-xs md:max-w-md justify-end">
                            <span className="text-[11px] sm:text-xs text-slate-600 font-bold shrink-0">
                              {team.votes.toLocaleString()} <span className="hidden sm:inline">votes</span>
                            </span>
                            <div className="flex-1 bg-slate-100 h-2 rounded-[4px] overflow-hidden border border-slate-200/50 min-w-[40px]">
                              <div 
                                className="bg-[#369d5c] h-full rounded-[4px] transition-all duration-500"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Right: Checkmark / Unvote Button */}
                        <button
                          onClick={() => handleVote(team.id)}
                          disabled={isButtonDisabled}
                          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-[4px] border flex items-center justify-center transition-all duration-200 shrink-0 ${
                            isHost || timeLeft === 0
                              ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                              : isUserSelection
                                ? "bg-[#369d5c] border-[#369d5c] text-white cursor-pointer shadow-sm hover:bg-rose-600 hover:border-rose-600 active:scale-95"
                                : isMaxVotesReached
                                  ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                                  : "bg-white border-slate-300 hover:border-[#369d5c] text-slate-400 hover:text-[#369d5c] hover:bg-[#369d5c]/5 active:scale-95 cursor-pointer"
                          }`}
                          title={
                            isHost 
                              ? "Host không thể bình chọn" 
                              : isUserSelection 
                                ? "Nhấp để bỏ chọn đội này" 
                                : isMaxVotesReached 
                                  ? "Đã chọn đủ 2 lượt (Nhấp vào đội đã chọn để bỏ chọn)" 
                                  : "Bình chọn cho đội này"
                          }
                        >
                          {isPendingThisTeam ? (
                            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Check className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isUserSelection ? "stroke-[3px]" : "stroke-[2px]"}`} />
                          )}
                        </button>

                      </div>
                    );
                  })}
                </div>

                {/* Voter Information note */}
                <div className="text-center text-[10px] text-slate-400 mt-2 font-medium shrink-0 flex flex-col gap-[6px]">
                  <p>{isHost ? "Giao diện Host (Host không thể bình chọn)." : "Mỗi người được vote tối đa 2 lần (không vote trùng đội)."}</p>
                  <p className="text-slate-300 text-[8px]">Bảo mật và đồng bộ tự động • Xác thực theo IP & Thiết bị</p>
                </div>

              </div>
            )}

          </div>

        </div>

      </main>

      {/* FLOATING ACTION TOOLBAR */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 z-40">
        {isHost && (
          <button
            onClick={() => setIsAdminOpen(true)}
            className="p-2 bg-slate-800 text-white rounded-[4px] hover:bg-slate-700 transition-colors shadow-lg cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Host Panel</span>
          </button>
        )}
      </div>

      {/* ADMIN OVERLAY CONFIG MODAL */}
      {isAdminOpen && isHost && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-[4px] shadow-2xl max-w-md w-full p-5 flex flex-col gap-[12px] relative animate-in fade-in zoom-in duration-200">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
                <Settings className="w-4 h-4 text-[#369d5c]" />
                Host Control Panel (Live)
              </span>
              <button 
                onClick={() => setIsAdminOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-[4px] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Voting Session Toggle Control */}
            <div className="flex flex-col gap-[6px]">
              <h3 className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Session Status</h3>
              <div className="flex items-center gap-2">
                {votingStarted ? (
                  <button 
                    onClick={async () => {
                      await sendHostAction("RESET_ALL");
                      setIsHost(false);
                      setIsAdminOpen(false);
                      safeRemoveLocalStorage("voting_app_is_host");
                      safeRemoveLocalStorage("voting_host_login_time");
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-[4px] cursor-pointer shadow-sm flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> End Voting & Sign Out
                  </button>
                ) : (
                  <button 
                    onClick={() => sendHostAction("START", { durationSeconds: duration })}
                    className="px-3 py-1.5 bg-[#369d5c] hover:bg-[#2c854e] text-white font-semibold text-xs rounded-[4px] cursor-pointer shadow-sm flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-white" /> Activate Voting Session
                  </button>
                )}
              </div>
            </div>

            {/* Timer Management Block */}
            {votingStarted && (
              <div className="flex flex-col gap-[6px] mt-1">
                <h3 className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Timer Management</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <button 
                    onClick={() => sendHostAction("TOGGLE_TIMER")}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    {timerRunning && timeLeft > 0 ? (
                      <><Pause className="w-3 h-3" /> Pause</>
                    ) : (
                      <><Play className="w-3 h-3" /> Resume</>
                    )}
                  </button>
                  <button 
                    onClick={() => sendHostAction("ADJUST_TIMER", { seconds: 60 })}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    + 1 min
                  </button>
                  <button 
                    onClick={() => sendHostAction("ADJUST_TIMER", { seconds: -60 })}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    - 1 min
                  </button>
                  <button 
                    onClick={() => sendHostAction("END_NOW")}
                    className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    End Now (0s)
                  </button>
                </div>
                
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-slate-500 text-xs font-medium">Reset timer:</span>
                  {[60, 300, 600].map(s => (
                    <button 
                      key={s}
                      onClick={() => sendHostAction("START", { durationSeconds: s })}
                      className="px-2 py-1 bg-[#369d5c]/10 text-[#369d5c] font-semibold text-xs rounded-[4px] hover:bg-[#369d5c]/20 cursor-pointer"
                    >
                      {s / 60} min
                  </button>
                  ))}
                </div>
              </div>
            )}

            {/* Description Text */}
            <div className="p-3 bg-slate-50 border border-slate-100 text-slate-500 text-[11px] rounded-[4px] leading-relaxed mt-2">
              <p className="font-bold text-slate-700 mb-0.5">Host Panel:</p>
              Use Session Status to activate or end voting, and Timer Management to control the countdown timer in real-time.
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
