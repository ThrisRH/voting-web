import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import DeviceDetector from "device-detector-js";
import { db } from "../../../lib/firebase";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  runTransaction
} from "firebase/firestore";

// Define constants
const ADMIN_PASSWORD = "123456";
const CONFIG_FILE_PATH = path.join(process.cwd(), "public", "teams.json");

interface SessionState {
  votingStarted: boolean;
  timerRunning: boolean;
  endTime: number | null;
  pausedTimeLeft: number;
  duration: number;
  title: string;
  votes: Record<string, number>;
  votedIps: Record<string, string | string[]>; // IP -> teamId or array of teamIds
  votedDevices?: Record<string, string | string[]>; // voterId -> teamId or array of teamIds
  resetTimestamp?: number;
}

// Helper to normalize votes to array of strings
function getVotedList(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return [val];
  return [];
}

// Helper to get client IP address across various proxy setups (Cloudflare, NGINX, Vercel, 4G, Wi-Fi)
function getClientIp(req: NextRequest): string {
  const headers = req.headers;

  // 1. Cloudflare / Enterprise proxy headers
  const cfIp = headers.get("cf-connecting-ip") || headers.get("true-client-ip") || headers.get("fastly-client-ip");
  if (cfIp && cfIp.trim()) {
    return cfIp.trim();
  }

  // 2. X-Forwarded-For (take the first IP in the chain)
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (firstIp) {
      return firstIp;
    }
  }

  // 3. X-Real-IP / X-Client-IP / X-Cluster-Client-IP
  const realIp = headers.get("x-real-ip") || headers.get("x-client-ip") || headers.get("x-cluster-client-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  // 4. NextRequest ip property
  const ipField = (req as any).ip;
  if (ipField && String(ipField).trim()) {
    return String(ipField).trim();
  }

  return "127.0.0.1";
}

// Helper to initialize default Firestore session doc
async function initializeFirestoreStore() {
  let configTitle = "Bình Chọn Đội Tuyển Xuất Sắc";
  let configDuration = 300;
  let configTeams: string[] = ["Team 1", "Team 2", "Team 3", "Team 4"];

  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const configData = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf8"));
      configTitle = configData.title || configTitle;
      configDuration = configData.votingDurationSeconds || configDuration;
      configTeams = configData.teams || configTeams;
    }
  } catch (err) {
    console.error("Error reading config teams.json file:", err);
  }

  const initialVotes: Record<string, number> = {};
  configTeams.forEach((_, idx) => {
    initialVotes[`team-${idx + 1}`] = 0;
  });

  const defaultStore: SessionState = {
    votingStarted: false,
    timerRunning: false,
    endTime: null,
    pausedTimeLeft: configDuration,
    duration: configDuration,
    title: configTitle,
    votes: initialVotes,
    votedIps: {},
    votedDevices: {}
  };

  const sessionDocRef = doc(db, "sessions", "voting_session");
  await setDoc(sessionDocRef, defaultStore);
  return defaultStore;
}

// Helper to get or initialize session
async function getSessionDoc(): Promise<SessionState> {
  const sessionDocRef = doc(db, "sessions", "voting_session");
  const docSnap = await getDoc(sessionDocRef);

  if (docSnap.exists()) {
    const data = docSnap.data() as SessionState;
    if (!data.votedIps) {
      data.votedIps = {};
    }
    if (!data.votedDevices) {
      data.votedDevices = {};
    }
    
    // Auto-update config if teams.json changed
    let configTeams: string[] = [];
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        const configData = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf8"));
        configTeams = configData.teams || [];
      }
    } catch (e) {}

    const updatedVotes = { ...data.votes };
    let hasChanges = false;
    configTeams.forEach((_, idx) => {
      const id = `team-${idx + 1}`;
      if (updatedVotes[id] === undefined) {
        updatedVotes[id] = 0;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      await updateDoc(sessionDocRef, { votes: updatedVotes });
      data.votes = updatedVotes;
    }

    return data;
  } else {
    return await initializeFirestoreStore();
  }
}

const deviceDetector = new DeviceDetector();

// Helper to get composite voter key (IP + User-Agent parsed device + fingerprint / voterId)
function getVoterKey(req: NextRequest, voterId: string, fingerprint?: string): string {
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "";
  
  let deviceSignature = "";
  try {
    if (userAgent) {
      const parsed = deviceDetector.parse(userAgent);
      const osName = parsed.os?.name || "";
      const osVer = parsed.os?.version || "";
      const deviceType = parsed.device?.type || "";
      const deviceBrand = parsed.device?.brand || "";
      const deviceModel = parsed.device?.model || "";
      const clientName = parsed.client?.name || "";
      
      const sig = `${osName}_${osVer}_${deviceType}_${deviceBrand}_${deviceModel}_${clientName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (sig && sig !== "_____") {
        deviceSignature = sig;
      }
    }
  } catch (e) {
    console.error("DeviceDetector error:", e);
  }

  const sanitizedIp = ip ? ip.replace(/[^a-zA-Z0-9_-]/g, "_") : "127_0_0_1";
  const sanitizedVoterId = voterId ? voterId.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const sanitizedFp = fingerprint ? fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_") : "";

  if (deviceSignature && sanitizedIp) {
    return `ip_${sanitizedIp}_dev_${deviceSignature}_fp_${sanitizedFp || sanitizedVoterId}`;
  }
  if (sanitizedFp && sanitizedIp) {
    return `ip_${sanitizedIp}_fp_${sanitizedFp}`;
  }
  if (sanitizedVoterId) {
    return `vid_${sanitizedVoterId}`;
  }
  return `ip_${sanitizedIp}`;
}

// GET handler: returns current status and if client device has voted
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const store = await getSessionDoc();
  const url = new URL(req.url);
  const voterId = url.searchParams.get("voterId") || "";
  const fingerprint = url.searchParams.get("fingerprint") || "";

  // Read team names from CONFIG_FILE_PATH
  let teamNames: string[] = ["Nhóm 1", "Nhóm 2", "Nhóm 3", "Nhóm 4"];
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const configData = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf8"));
      teamNames = configData.teams || teamNames;
    }
  } catch (e) {
    console.error(e);
  }

  // Format teams with names and vote counts
  const teamsList = teamNames.map((name, idx) => {
    const id = `team-${idx + 1}`;
    return {
      id,
      name,
      votes: store.votes[id] || 0
    };
  });

  const sanitizedVoterId = voterId ? voterId.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const sanitizedFp = fingerprint ? fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const voterKey = getVoterKey(req, voterId, fingerprint);
  
  const compositeVotes = store.votedDevices && voterKey ? getVotedList(store.votedDevices[voterKey]) : [];
  const deviceVotes = store.votedDevices && sanitizedVoterId ? getVotedList(store.votedDevices[sanitizedVoterId]) : [];
  const fpVotes = store.votedDevices && sanitizedFp ? getVotedList(store.votedDevices[`fp_${sanitizedFp}`]) : [];
  
  const votedTeamIds = Array.from(new Set([...compositeVotes, ...deviceVotes, ...fpVotes]));

  return NextResponse.json({
    title: store.title,
    duration: store.duration,
    votingStarted: store.votingStarted,
    timerRunning: store.timerRunning,
    endTime: store.endTime,
    pausedTimeLeft: store.pausedTimeLeft,
    teams: teamsList,
    clientIp: ip,
    hasVoted: votedTeamIds.length >= 2,
    votedTeamIds: votedTeamIds,
    votedTeamId: votedTeamIds.length > 0 ? votedTeamIds[0] : null
  });
}

// POST handler: casts a vote for a team based on composite key (IP + fingerprint / voterId)
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const body = await req.json();
  const { teamId, voterId, fingerprint } = body;

  if (!teamId) {
    return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  }

  const sanitizedVoterId = voterId ? voterId.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
  const voterKey = getVoterKey(req, voterId, fingerprint);
  const sessionDocRef = doc(db, "sessions", "voting_session");

  try {
    const result = await runTransaction(db, async (transaction) => {
      const sessionSnap = await transaction.get(sessionDocRef);
      if (!sessionSnap.exists()) {
        return { error: "The voting session has not been initialized!" };
      }

      const session = sessionSnap.data() as SessionState;
      const votedDevices = session.votedDevices || {};

      // Read existing votes for ALL possible keys for this voter (composite + voterId + fp)
      const sanitizedFp = fingerprint ? fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
      const fpKey = sanitizedFp ? `fp_${sanitizedFp}` : "";
      const allVoterKeys = Array.from(new Set([voterKey, sanitizedVoterId, fpKey].filter(Boolean)));
      const allExistingVotes = allVoterKeys.flatMap(k => getVotedList(votedDevices[k]));
      const combinedVotes = Array.from(new Set(allExistingVotes));

      if (!session.votingStarted) {
        return { error: "Voting has not started yet!" };
      }

      // If timer is running, check end time. If paused, check remaining time.
      if (session.timerRunning) {
        if (session.endTime && Date.now() > session.endTime) {
          return { error: "Voting time has ended!" };
        }
      } else {
        if (session.pausedTimeLeft <= 0) {
          return { error: "Voting time has ended!" };
        }
      }

      const updatedVotes = { ...session.votes };
      const isAlreadyVoted = combinedVotes.includes(teamId);
      let newVoteList: string[] = [];
      let actionType = "";

      if (isAlreadyVoted) {
        // UNVOTE / Bỏ chọn: Giảm số vote và xóa khỏi danh sách
        updatedVotes[teamId] = Math.max(0, (updatedVotes[teamId] || 1) - 1);
        newVoteList = combinedVotes.filter(id => id !== teamId);
        actionType = "UNVOTED";
      } else {
        // VOTE / Chọn mới: Kiểm tra giới hạn 2 vote — checked INSIDE transaction (atomic)
        if (combinedVotes.length >= 2) {
          return { 
            error: "Bạn đã sử dụng tối đa 2 lượt bình chọn! Vui lòng bỏ chọn một đội trước khi chọn đội mới." 
          };
        }
        updatedVotes[teamId] = (updatedVotes[teamId] || 0) + 1;
        newVoteList = Array.from(new Set([...combinedVotes, teamId]));
        actionType = "VOTED";
      }

      const updatedVotedDevices = { ...votedDevices };
      if (voterKey) {
        updatedVotedDevices[voterKey] = newVoteList;
      }
      if (sanitizedVoterId) {
        updatedVotedDevices[sanitizedVoterId] = newVoteList;
      }
      if (sanitizedFp) {
        updatedVotedDevices[`fp_${sanitizedFp}`] = newVoteList;
      }

      // Perform database updates
      transaction.update(sessionDocRef, { 
        votes: updatedVotes,
        votedDevices: updatedVotedDevices
      });

      return { 
        success: true, 
        votedTeamIds: newVoteList, 
        action: actionType 
      };
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      votedTeamIds: result.votedTeamIds,
      action: result.action,
      clientIp: ip
    });

  } catch (err) {
    console.error("Firestore transaction error during vote:", err);
    return NextResponse.json({ error: "Database transaction failed!" }, { status: 500 });
  }
}

// PUT handler: Admin operations (Start, Reset, Stop)
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { action, password, durationSeconds } = body;

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const sessionDocRef = doc(db, "sessions", "voting_session");
  const store = await getSessionDoc();

  if (action === "START") {
    const finalDuration = durationSeconds || store.duration;
    const targetEndTime = Date.now() + finalDuration * 1000;
    
    // Reset votes and device/IP locks when starting/reactivating a session
    const resetVotes: Record<string, number> = {};
    Object.keys(store.votes).forEach(key => {
      resetVotes[key] = 0;
    });

    await updateDoc(sessionDocRef, {
      votingStarted: true,
      timerRunning: true,
      endTime: targetEndTime,
      pausedTimeLeft: finalDuration,
      votes: resetVotes,
      votedIps: {},
      votedDevices: {}
    });
  } 
  else if (action === "RESET_ALL") {
    // Reset voting session variables and clear votedDevices/votedIps map
    const resetVotes: Record<string, number> = {};
    Object.keys(store.votes).forEach(key => {
      resetVotes[key] = 0;
    });

    await updateDoc(sessionDocRef, {
      votingStarted: false,
      timerRunning: false,
      endTime: null,
      pausedTimeLeft: store.duration,
      votes: resetVotes,
      votedIps: {},
      votedDevices: {},
      resetTimestamp: Date.now()
    });
  }
  else if (action === "RESET_VOTES") {
    // Reset votes only and clear votedDevices/votedIps map
    const resetVotes: Record<string, number> = {};
    Object.keys(store.votes).forEach(key => {
      resetVotes[key] = 0;
    });

    await updateDoc(sessionDocRef, {
      votes: resetVotes,
      votedIps: {},
      votedDevices: {}
    });
  }
  else if (action === "TOGGLE_TIMER") {
    if (store.timerRunning) {
      if (store.endTime) {
        const remaining = Math.max(0, Math.floor((store.endTime - Date.now()) / 1000));
        await updateDoc(sessionDocRef, {
          timerRunning: false,
          pausedTimeLeft: remaining,
          endTime: null
        });
      }
    } else {
      const targetEndTime = Date.now() + store.pausedTimeLeft * 1000;
      await updateDoc(sessionDocRef, {
        timerRunning: true,
        endTime: targetEndTime
      });
    }
  }
  else if (action === "ADJUST_TIMER") {
    const { seconds } = body;
    if (store.timerRunning) {
      if (store.endTime) {
        await updateDoc(sessionDocRef, {
          endTime: store.endTime + seconds * 1000
        });
      }
    } else {
      const newPausedTime = Math.max(0, store.pausedTimeLeft + seconds);
      await updateDoc(sessionDocRef, {
        pausedTimeLeft: newPausedTime
      });
    }
  }
  else if (action === "END_NOW") {
    await updateDoc(sessionDocRef, {
      timerRunning: false,
      pausedTimeLeft: 0,
      endTime: Date.now()
    });
  }

  return NextResponse.json({ success: true });
}

