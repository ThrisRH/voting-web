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
  AlertCircle
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

export default function Home() {
  // Data States
  const [title, setTitle] = useState<string>("Bình Chọn Đội Tuyển Xuất Sắc");
  const [duration, setDuration] = useState<number>(300);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamNamesConfig, setTeamNamesConfig] = useState<string[]>([]);
  const [totalVotes, setTotalVotes] = useState<number>(0);
  const [clientIp, setClientIp] = useState<string>("");
  
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
  const [hasVoted, setHasVoted] = useState<string | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confettiFired, setConfettiFired] = useState<boolean>(false);

  // Fetch initial config and check voter IP status once on mount
  useEffect(() => {
    async function initializeClient() {
      try {
        // 1. Fetch IP status from API
        const statusRes = await fetch("/api/voting");
        if (statusRes.ok) {
          const data = await statusRes.json();
          setClientIp(data.clientIp || "127.0.0.1");
          if (data.hasVoted && data.votedTeamId) {
            setHasVoted(data.votedTeamId);
          }
        }

        // 2. Fetch team config names
        const configRes = await fetch("/teams.json");
        if (configRes.ok) {
          const config = await configRes.json();
          setTitle(config.title || "Bình Chọn Đội Tuyển Xuất Sắc");
          setDuration(config.votingDurationSeconds || 300);
          setTeamNamesConfig(config.teams || []);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        setLoading(false);
      }
    }

    initializeClient();

    // Check host status in sessionStorage
    const hostFlag = sessionStorage.getItem("voting_app_is_host") === "true";
    setIsHost(hostFlag);
  }, []);

  // Listen to Firestore changes in real-time
  useEffect(() => {
    if (loading || teamNamesConfig.length === 0) return;

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
          
          // Map team names config to real-time votes counts
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

          // Update hasVoted based on our clientIp inside votedIps map
          if (clientIp) {
            const sanitizedIp = clientIp.replace(/\./g, "_").replace(/\//g, "_");
            const votedIpsMap = data.votedIps || {};
            setHasVoted(votedIpsMap[sanitizedIp] || null);
          }
        }
      },
      (error) => {
        console.error("Firestore listening error:", error);
      }
    );

    return unsubscribe;
  }, [loading, teamNamesConfig, duration, clientIp]);

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

  // Submit Vote through secure API to check IP Address
  const handleVote = async (teamId: string) => {
    if (!votingStarted || timeLeft === 0) return;
    if (hasVoted) return;

    // Optimistic Update (Immediate visual response & confetti)
    setHasVoted(teamId);
    triggerVoteConfetti();

    try {
      const res = await fetch("/api/voting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId })
      });

      const data = await res.json();
      
      if (!res.ok) {
        // Revert optimistic update on failure
        setHasVoted(null);
        setErrorMessage(data.error || "Có lỗi xảy ra!");
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (err) {
      console.error(err);
      // Revert optimistic update on error
      setHasVoted(null);
      setErrorMessage("Không thể kết nối đến máy chủ!");
      setTimeout(() => setErrorMessage(null), 5000);
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
      sessionStorage.setItem("voting_app_is_host", "true");
    } else {
      setPasswordError(true);
    }
  };

  // Victory Banner: only reveals details to host after timer ends
  const renderVictoryText = () => {
    if (!isHost) {
      return "Victory: (có thể là team của bạn)";
    }
    
    if (timeLeft > 0 || !votingStarted) {
      return "Victory: (có thể là team của bạn)";
    } else {
      const winner = getWinner();
      if (winner && totalVotes > 0) {
        return `Victory: ${winner.name}`;
      } else {
        return "Victory: Chưa có đội chiến thắng (0 phiếu)";
      }
    }
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
      <main className="flex-1 flex flex-col justify-center items-center p-4 md:p-6 overflow-hidden w-full max-w-2xl mx-auto">
        
        {/* Core Container Card */}
        <div className="w-full bg-white border border-[#e2e8f0] p-5 md:p-8 shadow-sm rounded-[4px] flex flex-col overflow-hidden max-h-full">
          
          {/* HEADER (12px gap) */}
          <div className="flex flex-col items-center gap-[12px] w-full text-center shrink-0">
            
            {/* Logo */}
            <div className="relative h-14 md:h-18 flex items-center justify-center">
              <img
                src="/logo.png"
                alt="Voting App Logo"
                className="h-full w-auto object-contain mx-auto"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = "none";
                }}
              />
              <noscript>
                <div className="w-12 h-12 rounded-[4px] bg-[#369d5c]/10 border border-[#369d5c] flex items-center justify-center">
                  <Award className="w-6 h-6 text-[#369d5c]" />
                </div>
              </noscript>
            </div>

            {/* Victory Text Banner */}
            <div className="w-full max-w-sm px-4 py-1.5 bg-[#f4faf6] border border-[#369d5c]/10 text-[#369d5c] font-semibold text-xs md:text-sm rounded-[4px] flex items-center justify-center gap-1.5 animate-pulse shrink-0">
              <Trophy className="w-3.5 h-3.5 shrink-0 text-[#369d5c]" />
              <span className="tracking-wide text-center truncate">
                {renderVictoryText()}
              </span>
            </div>

            {/* Title & Status indicator */}
            <div className="flex flex-col items-center gap-[12px]">
              <h1 className="text-xl md:text-2xl font-extrabold text-slate-800 tracking-tight leading-tight">
                {title}
              </h1>

              {/* Timer Badge */}
              {votingStarted && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-[4px]">
                  <Timer className={`w-3.5 h-3.5 ${timerRunning && timeLeft > 0 ? "text-[#369d5c] animate-spin-slow" : "text-slate-400"}`} />
                  <span className="text-xs font-semibold tracking-wider font-mono text-slate-700">
                    {timeLeft > 0 ? formatTime(timeLeft) : "Thời gian đã hết"}
                  </span>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${timeLeft > 0 ? (timerRunning ? "bg-[#369d5c] animate-ping" : "bg-amber-400") : "bg-rose-500"}`} />
                </div>
              )}
            </div>

          </div>

          {/* SPACING: 32px gap between header and content card area */}
          <div className="mt-[32px] flex-1 flex flex-col gap-[12px] overflow-hidden">
            
            {loading ? (
              <div className="flex-1 flex justify-center items-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#369d5c]"></div>
              </div>
            ) : !votingStarted ? (
              
              /* CASE 1: Voting NOT STARTED Yet */
              <div className="flex-1 flex flex-col justify-center items-center text-center p-4 gap-[12px]">
                
                {isHost ? (
                  /* Host waiting view */
                  <div className="flex flex-col items-center gap-[12px] max-w-sm">
                    <div className="w-12 h-12 bg-[#369d5c]/10 text-[#369d5c] rounded-[4px] flex items-center justify-center">
                      <Settings className="w-6 h-6 animate-pulse" />
                    </div>
                    <div className="flex flex-col gap-[6px]">
                      <h2 className="font-bold text-slate-800 text-base">Giao Diện Người Chủ Trì</h2>
                      <p className="text-xs text-slate-500">Nhập danh sách đội trong file <code className="bg-slate-100 px-1 py-0.5 rounded font-mono font-bold">public/teams.json</code>. Nhấp nút Bắt đầu để kích hoạt hệ thống.</p>
                    </div>
                    <button
                      onClick={() => sendHostAction("START", { durationSeconds: duration })}
                      className="w-full mt-2 py-2.5 px-4 bg-[#369d5c] hover:bg-[#2c854e] text-white font-bold text-sm rounded-[4px] transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98 cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-white" /> Bắt Đầu Bình Chọn
                    </button>
                  </div>
                ) : (
                  /* Employee waiting view */
                  <div className="flex flex-col items-center gap-[12px] max-w-sm">
                    <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-[4px] border border-slate-100 flex items-center justify-center animate-bounce">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col gap-[6px]">
                      <h2 className="font-bold text-slate-700 text-sm md:text-base">Chờ Kích Hoạt Bình Chọn</h2>
                      <p className="text-xs text-slate-400">Cuộc bình chọn chưa bắt đầu. Vui lòng đợi Người chủ trì (Ban tổ chức) bắt đầu phiên biểu quyết.</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-600 border border-amber-100 text-[10px] font-bold rounded-[4px] uppercase animate-pulse">
                      Đang kết nối hệ thống
                    </span>
                  </div>
                )}
                
                {/* Host authentication login form inside waiting page */}
                {!isHost && (
                  <form onSubmit={handleHostLogin} className="w-full max-w-xs mt-6 pt-4 border-t border-slate-100 flex flex-col gap-[6px]">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                      <span>Dành cho Người chủ trì:</span>
                      {passwordError && <span className="text-rose-500 font-bold">Mật khẩu sai!</span>}
                    </div>
                    <div className="flex items-center gap-[6px]">
                      <div className="relative flex-1">
                        <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                        <input
                          type="password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="Mật khẩu (123456)"
                          className="w-full pl-7 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-[4px] text-xs focus:outline-none focus:border-[#369d5c] focus:bg-white text-slate-700 placeholder:text-slate-400"
                        />
                      </div>
                      <button
                        type="submit"
                        className="p-1.5 bg-slate-800 text-white rounded-[4px] hover:bg-slate-700 transition-colors cursor-pointer"
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
                    <span className="flex items-center gap-1"><Settings className="w-3 h-3 text-[#369d5c]" /> Giao diện Chủ trì (Live Results):</span>
                    <span className="text-slate-800 font-bold bg-[#369d5c]/5 border border-[#369d5c]/15 px-2.5 py-0.5 rounded-[4px]">
                      {totalVotes.toLocaleString()} phiếu bầu
                    </span>
                  </div>
                )}

                {/* Team Rows list (Scrollable if overflow) */}
                <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-[12px]">
                  {teams.map((team, index) => {
                    const percent = getPercentage(team.votes);
                    const isLeading = timeLeft === 0 && getWinner()?.id === team.id && totalVotes > 0;
                    const isUserSelection = hasVoted === team.id;
                    
                    return (
                      <div 
                        key={team.id}
                        className={`flex items-center justify-between p-3 bg-white border rounded-[4px] transition-all duration-200 relative overflow-hidden ${
                          isUserSelection 
                            ? "border-[#369d5c] bg-[#369d5c]/5 ring-1 ring-[#369d5c]" 
                            : isLeading && isHost
                              ? "border-amber-300 bg-amber-50/10" 
                              : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {/* Left: Avatar + Team Name (6px gap) */}
                        <div className="flex items-center gap-[6px] min-w-0 flex-1">
                          <div className="w-8 h-8 flex items-center justify-center font-bold text-xs text-white rounded-[4px] shrink-0"
                               style={{ backgroundColor: `hsl(${135 + index * 45}, 45%, 43%)` }}>
                            {team.name.charAt(0)}
                          </div>
                          <span className="truncate font-bold text-slate-800 text-sm md:text-base" title={team.name}>
                            {team.name}
                          </span>
                        </div>

                        {/* Middle: Vote representation (DIFFERENT between Host & Voter) */}
                        {isHost ? (
                          /* Host gets visual stats, vote counts & progress bars (NO percentages shown) */
                          <div className="flex items-center gap-[12px] flex-1 px-4 max-w-xs md:max-w-md">
                            <span className="text-xs text-slate-500 font-bold shrink-0">
                              {team.votes.toLocaleString()} phiếu
                            </span>
                            <div className="flex-1 bg-slate-100 h-1.5 rounded-[4px] overflow-hidden">
                              <div 
                                className="bg-[#369d5c] h-full rounded-[4px] transition-all duration-500"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          /* Employees/Voters see ABSOLUTELY NO stats (no count, no bars, no percent) */
                          <div className="flex-1 px-4" />
                        )}

                        {/* Right: Checkmark Button */}
                        <button
                          onClick={() => handleVote(team.id)}
                          disabled={timeLeft === 0 || !!hasVoted}
                          className={`w-8 h-8 rounded-[4px] border flex items-center justify-center transition-all duration-200 shrink-0 cursor-pointer ${
                            timeLeft === 0
                              ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                              : hasVoted
                                ? isUserSelection
                                  ? "bg-[#369d5c] border-[#369d5c] text-white cursor-default shadow-sm"
                                  : "bg-slate-50 border-slate-100 text-slate-300 cursor-default"
                                : "bg-white border-slate-300 hover:border-[#369d5c] text-slate-400 hover:text-[#369d5c] hover:bg-[#369d5c]/5 active:scale-95"
                          }`}
                          title={isUserSelection ? "Đã bình chọn" : "Bình chọn cho đội này"}
                        >
                          <Check className={`w-4 h-4 ${isUserSelection ? "stroke-[3px]" : "stroke-[2px]"}`} />
                        </button>

                      </div>
                    );
                  })}
                </div>

                {/* Voter Information note */}
                <div className="text-center text-[10px] text-slate-400 mt-2 font-medium shrink-0 flex flex-col gap-[6px]">
                  <p>Mỗi người tham gia được bình chọn tối đa 01 lượt duy nhất.</p>
                  <p className="text-slate-300 text-[8px]">Hệ thống bảo mật và đồng bộ hóa qua Firebase Cloud • IP thiết bị: {clientIp}</p>
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
            <span>Chủ Trì</span>
          </button>
        )}

        {isHost && (
          <button
            onClick={() => {
              setIsHost(false);
              setIsAdminOpen(false);
              sessionStorage.removeItem("voting_app_is_host");
            }}
            className="p-2 bg-rose-600 text-white rounded-[4px] hover:bg-rose-700 transition-colors shadow-lg cursor-pointer flex items-center gap-1 text-xs font-semibold"
            title="Thoát quyền chủ trì, chuyển thành Nhân viên"
          >
            <X className="w-3.5 h-3.5" />
            <span>Thoát</span>
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
                Bảng điều khiển Chủ trì (Live)
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
              <h3 className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Trạng thái phiên biểu quyết</h3>
              <div className="flex items-center gap-2">
                {votingStarted ? (
                  <button 
                    onClick={async () => {
                      await sendHostAction("RESET_ALL");
                      setIsHost(false);
                      setIsAdminOpen(false);
                      sessionStorage.removeItem("voting_app_is_host");
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-[4px] cursor-pointer shadow-sm flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> Kết Thúc Bỏ Phiếu & Đăng Xuất
                  </button>
                ) : (
                  <button 
                    onClick={() => sendHostAction("START", { durationSeconds: duration })}
                    className="px-3 py-1.5 bg-[#369d5c] hover:bg-[#2c854e] text-white font-semibold text-xs rounded-[4px] cursor-pointer shadow-sm flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-white" /> Kích Hoạt Phiên Bầu Chọn
                  </button>
                )}
              </div>
            </div>

            {/* Timer Management Block */}
            {votingStarted && (
              <div className="flex flex-col gap-[6px] mt-1">
                <h3 className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Quản Lý Thời Gian</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <button 
                    onClick={() => sendHostAction("TOGGLE_TIMER")}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    {timerRunning && timeLeft > 0 ? (
                      <><Pause className="w-3 h-3" /> Tạm Dừng</>
                    ) : (
                      <><Play className="w-3 h-3" /> Tiếp Tục</>
                    )}
                  </button>
                  <button 
                    onClick={() => sendHostAction("ADJUST_TIMER", { seconds: 60 })}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    + 1 phút
                  </button>
                  <button 
                    onClick={() => sendHostAction("ADJUST_TIMER", { seconds: -60 })}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    - 1 phút
                  </button>
                  <button 
                    onClick={() => sendHostAction("END_NOW")}
                    className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 font-semibold text-xs rounded-[4px] cursor-pointer"
                  >
                    Hết giờ ngay (0s)
                  </button>
                </div>
                
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-slate-500 text-xs font-medium">Đặt lại timer:</span>
                  {[60, 300, 600].map(s => (
                    <button 
                      key={s}
                      onClick={() => sendHostAction("START", { durationSeconds: s })}
                      className="px-2 py-1 bg-[#369d5c]/10 text-[#369d5c] font-semibold text-xs rounded-[4px] hover:bg-[#369d5c]/20 cursor-pointer"
                    >
                      {s / 60} Phút
                  </button>
                  ))}
                </div>
              </div>
            )}

            {/* Vote Management Block */}
            <div className="flex flex-col gap-[6px] mt-1">
              <h3 className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">Khôi Phục Khóa IP & Phiếu Bầu</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <button 
                  onClick={() => sendHostAction("RESET_VOTES")}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-[4px] cursor-pointer shadow-sm"
                  title="Xóa sạch các lượt bầu chọn đã ghi nhận và reset khóa IP"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reset Số Phiếu & Mở Khóa IP
                </button>
                <button 
                  onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs rounded-[4px] cursor-pointer"
                >
                  Xóa Cache Trình Duyệt
                </button>
              </div>
            </div>

            {/* Description Text */}
            <div className="p-3 bg-slate-50 border border-slate-100 text-slate-500 text-[11px] rounded-[4px] leading-relaxed mt-2">
              <p className="font-bold text-slate-700 mb-0.5">Khóa IP hoạt động như thế nào:</p>
              Hệ thống ghi nhận địa chỉ IP của từng thiết bị vào Firebase. Dù tải lại trang hay xóa cache trình duyệt, thiết bị đó vẫn không thể bầu chọn lại trừ khi bấm nút <strong>&quot;Reset Số Phiếu &amp; Mở Khóa IP&quot;</strong> ở trên.
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
