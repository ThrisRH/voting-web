"use client";

import { useState, useEffect, useRef } from "react";
import {
  Trophy,
  Timer,
  Check,
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

interface ZaloUser {
  id: string;
  name: string;
  avatar: string;
}

const ADMIN_PASSWORD = "123456";

// Safe localStorage access wrappers
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
    // Ignore storage restrictions
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

// Read Zalo User from document cookies
function getZaloUserFromCookie(): ZaloUser | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(^|;)\s*zalo_user\s*=\s*([^;]+)/);
  if (match) {
    try {
      return JSON.parse(decodeURIComponent(match[2])) as ZaloUser;
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Clear cookie session
function deleteZaloCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "zalo_user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;";
}

export default function Home() {
  // Data States
  const [duration, setDuration] = useState<number>(300);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamNamesConfig, setTeamNamesConfig] = useState<string[]>([]);
  const [totalVotes, setTotalVotes] = useState<number>(0);
  const [clientIp, setClientIp] = useState<string>("");
  const [voterId, setVoterId] = useState<string>("");
  const [zaloUser, setZaloUser] = useState<ZaloUser | null>(null);
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
  const [serverVoterKey, setServerVoterKey] = useState<string>("");
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confettiFired, setConfettiFired] = useState<boolean>(false);

  // Consolidated client initialization
  useEffect(() => {
    let isSubscribed = true;

    async function initializeClient() {
      try {
        // Read Zalo User Session
        const user = getZaloUserFromCookie();
        if (isSubscribed) {
          setZaloUser(user);
          if (user) {
            setVoterId(user.id);
          }
        }

        // Fetch IP & initial voted status
        const statusRes = await fetch(
          `/api/voting?voterId=${encodeURIComponent(user?.id || "")}`,
          { cache: "no-store" }
        ).catch(() => null);

        if (statusRes && statusRes.ok) {
          const data = await statusRes.json().catch(() => ({}));
          if (isSubscribed) {
            setClientIp(data.clientIp || "127.0.0.1");
            if (data.voterKey) {
              setServerVoterKey(data.voterKey);
            }
            if (Array.isArray(data.votedTeamIds)) {
              setVotedTeamIds(data.votedTeamIds);
            } else if (data.votedTeamId) {
              setVotedTeamIds([data.votedTeamId]);
            } else {
              setVotedTeamIds([]);
            }
          }
        }

        // Fetch team config names
        const configRes = await fetch("/teams.json", { cache: "no-store" }).catch(() => null);
        let defaultTeams = ["Team 1", "Team 2", "Team 3", "Team 4"];
        if (configRes && configRes.ok) {
          const config = await configRes.json().catch(() => null);
          if (config && Array.isArray(config.teams) && config.teams.length > 0) {
            defaultTeams = config.teams;
            setDuration(config.votingDurationSeconds || 300);
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
  }, []);

  // Listen to Firestore changes in real-time
  useEffect(() => {
    if (loading) return;

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

          const votedDevicesMap = data.votedDevices || {};

          const getVotedList = (val: any): string[] => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            if (typeof val === "string") return [val];
            return [];
          };

          const currentVotedIds = serverVoterKey ? getVotedList(votedDevicesMap[serverVoterKey]) : [];
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
  }, [loading, teamNamesConfig, duration, voterId, clientIp, serverVoterKey]);

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
      const res = await fetch("/api/voting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, voterId })
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

  // Victory Banner
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

    const maxVotes = winner.votes;
    const tiedTeams = teams.filter(t => t.votes === maxVotes && maxVotes > 0);

    if (tiedTeams.length > 1) {
      const names = tiedTeams.map(t => t.name).join(" & ");
      return `🤝 Hòa: ${names}`;
    }

    return `Victory: ${winner.name}`;
  };

  const handleZaloLogin = () => {
    const appId = process.env.APP_ID || "";
    const callbackUrl = process.env.URL || "";
    const state = Math.random().toString(36).substring(7);

    if (!appId) {
      alert("Chưa cấu hình Zalo App ID! Vui lòng thiết lập trong file .env");
      return;
    }

    // Redirect to Zalo authorization page
    window.location.href = `https://oauth.zaloapp.com/v4/permission?app_id=${appId}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;
  };

  const handleSignOut = () => {
    deleteZaloCookie();
    setZaloUser(null);
    setVoterId("");
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-screen max-h-screen w-full bg-[#fcfefd] text-[#1e293b] font-sans antialiased overflow-hidden select-none relative">
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

          {/* HEADER */}
          <div className="flex flex-col items-center gap-[12px] w-full text-center shrink-0">

            {/* Event Hero Banner */}
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

          <div className="mt-4 sm:mt-[32px] flex-1 flex flex-col gap-[12px] overflow-hidden">

            {loading ? (
              <div className="flex-1 flex justify-center items-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#369d5c]"></div>
              </div>
            ) : !zaloUser && !isHost ? (

              /* CASE 0: USER NOT LOGGED IN YET (ZALO BLOCKER) */
              <div className="flex-1 flex flex-col justify-center items-center text-center p-4 gap-6">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center border border-blue-100">
                  <Users className="w-8 h-8 text-blue-500" />
                </div>

                <div className="flex flex-col gap-2 max-w-sm">
                  <h2 className="font-bold text-slate-800 text-lg">Đăng Nhập Zalo</h2>
                  <p className="text-xs text-slate-500 leading-relaxed px-4">
                    Vui lòng đăng nhập tài khoản Zalo của bạn để xác minh danh tính và bắt đầu tham gia bình chọn.
                  </p>
                </div>

                <button
                  onClick={handleZaloLogin}
                  className="w-full max-w-xs py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-[4px] shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                >
                  <img src="/vote.png" alt="Zalo Logo" className="w-5 h-5 object-contain invert brightness-200" onError={(e) => e.currentTarget.style.display = "none"} />
                  Đăng Nhập Bằng Zalo
                </button>

                {/* Host access on lock screen */}
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
              </div>

            ) : !votingStarted ? (

              /* CASE 1: Voting NOT STARTED Yet */
              <div className="flex-1 flex flex-col justify-center items-center text-center p-2 sm:p-4 gap-[12px]">

                {isHost ? (
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
                  <div className="flex flex-col items-center gap-[12px] max-w-sm">
                    {/* User Profile display */}
                    {zaloUser && (
                      <div className="flex items-center gap-2 mb-4 p-2 bg-slate-50 border border-slate-100 rounded-full pr-4">
                        <img src={zaloUser.avatar} alt={zaloUser.name} className="w-8 h-8 rounded-full border border-slate-200" />
                        <div className="flex flex-col text-left">
                          <span className="text-[10px] text-slate-400 font-medium">Đã đăng nhập:</span>
                          <span className="text-xs font-bold text-slate-700 leading-tight">{zaloUser.name}</span>
                        </div>
                        <button onClick={handleSignOut} className="ml-2 text-slate-400 hover:text-rose-500 cursor-pointer">
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

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

              </div>

            ) : (

              /* CASE 2: Voting ACTIVE / STARTED */
              <div className="flex-1 flex flex-col gap-[12px] overflow-hidden">

                {/* User Info & Signout in active mode */}
                {!isHost && zaloUser && (
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <img src={zaloUser.avatar} alt={zaloUser.name} className="w-7 h-7 rounded-full border border-slate-200" />
                      <span className="text-xs text-slate-600">Xin chào, <strong className="text-slate-800">{zaloUser.name}</strong></span>
                    </div>
                    <button onClick={handleSignOut} className="text-xs text-slate-400 hover:text-rose-500 flex items-center gap-1 cursor-pointer">
                      <LogOut className="w-3.5 h-3.5" /> Đăng xuất
                    </button>
                  </div>
                )}

                {isHost && (
                  <div className="flex justify-between items-center text-xs border-b border-slate-100 pb-1.5 text-slate-500 font-medium shrink-0">
                    <span className="flex items-center gap-1"><Settings className="w-3 h-3 text-[#369d5c]" /> Host View (Live Results):</span>
                    <span className="text-slate-800 font-bold bg-[#369d5c]/5 border border-[#369d5c]/15 px-2.5 py-0.5 rounded-[4px]">
                      Total Votes: {totalVotes}
                    </span>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto pr-1">
                  <div className="flex flex-col gap-[8px] py-1">
                    {teams.map((team) => {
                      const isVoted = votedTeamIds.includes(team.id);
                      const isPending = pendingTeamId === team.id;
                      const percentage = getPercentage(team.votes);
                      const displayPercentage = percentage > 0 ? `${percentage}%` : "0%";

                      const showResults = isHost || timeLeft === 0;

                      return (
                        <div key={team.id} className="relative w-full shrink-0">
                          <button
                            onClick={() => handleVote(team.id)}
                            disabled={isHost || timeLeft === 0 || isPending}
                            className={`w-full text-left p-3.5 border rounded-[4px] relative overflow-hidden transition-all flex items-center justify-between gap-4 leading-normal select-none
                              ${isVoted
                                ? "bg-[#369d5c]/5 border-[#369d5c] shadow-sm text-slate-900"
                                : "bg-white border-[#e2e8f0] text-slate-700 hover:border-slate-300 hover:bg-slate-50/50"
                              }
                              ${(isHost || timeLeft === 0) ? "cursor-default" : "cursor-pointer active:scale-[0.99]"}
                            `}
                          >
                            <div className="flex items-center gap-2.5 z-10 min-w-0 flex-1">
                              <div className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center shrink-0 transition-colors
                                ${isVoted
                                  ? "bg-[#369d5c] border-[#369d5c] text-white"
                                  : "border-slate-300 bg-white"
                                }
                              `}>
                                {isVoted && <Check className="w-3 h-3 stroke-[3]" />}
                              </div>
                              <span className="font-bold text-xs md:text-sm truncate pr-1">
                                {team.name}
                              </span>
                            </div>

                            {showResults && (
                              <div className="flex items-center gap-2 z-10 shrink-0 text-right">
                                <span className="text-slate-800 font-bold text-xs md:text-sm">
                                  {displayPercentage}
                                </span>
                                <span className="text-slate-400 text-[10px] font-semibold md:text-xs">
                                  ({team.votes})
                                </span>
                              </div>
                            )}

                            {showResults && (
                              <div
                                className="absolute inset-y-0 left-0 bg-[#369d5c]/10 transition-all duration-500 ease-out z-0"
                                style={{ width: `${percentage}%` }}
                              />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {!isHost && (
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-medium shrink-0 pt-1.5 border-t border-slate-100">
                    <span>Lượt bình chọn còn lại: {Math.max(0, 2 - votedTeamIds.length)}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3 text-[#369d5c]" /> Bình chọn an toàn qua Zalo</span>
                  </div>
                )}

              </div>
            )}

          </div>
        </div>
      </main>

      {/* HOST SETTING DRAWER */}
      {isAdminOpen && (
        <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-slate-200/80 shadow-2xl z-40 p-5 flex flex-col gap-4 animate-in slide-in-from-right duration-200">
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-[#369d5c]" /> Admin Control Panel
            </h2>
            <button
              onClick={() => setIsAdminOpen(false)}
              className="p-1 hover:bg-slate-100 rounded-[4px] cursor-pointer text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
            {/* Session Status Block */}
            <div className="flex flex-col gap-2">
              <h3 className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Session Status</h3>
              <div className="flex items-center gap-2">
                {votingStarted ? (
                  <button
                    onClick={() => sendHostAction("RESET_ALL")}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 font-semibold text-xs rounded-[4px] cursor-pointer shadow-sm flex items-center gap-1"
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
