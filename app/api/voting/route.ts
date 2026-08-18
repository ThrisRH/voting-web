import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "../../../lib/firebase";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  runTransaction,
  collection,
  getDocs,
  writeBatch
} from "firebase/firestore";

// Define constants
const ADMIN_PASSWORD = "123456";
const CONFIG_FILE_PATH = path.join(process.cwd(), "public", "teams.json");

interface FirestoreStore {
  votingStarted: boolean;
  timerRunning: boolean;
  endTime: number | null;
  duration: number;
  title: string;
  votes: Record<string, number>;
}

// Helper to get client IP address
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  
  const ipField = (req as any).ip;
  if (ipField) {
    return ipField.trim();
  }
  
  return "127.0.0.1";
}

// Helper to initialize default document structure from teams.json configuration
async function initializeFirestoreStore() {
  let configTitle = "Bình Chọn Đội Tuyển Xuất Sắc";
  let configDuration = 300;
  let configTeams: string[] = ["Nhóm 1", "Nhóm 2", "Nhóm 3", "Nhóm 4"];

  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const configData = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf8"));
      configTitle = configData.title || configTitle;
      configDuration = configData.votingDurationSeconds || configDuration;
      configTeams = configData.teams || configTeams;
    }
  } catch (err) {
    console.error("Error reading public/teams.json config file:", err);
  }

  const initialVotes: Record<string, number> = {};
  configTeams.forEach((_, idx) => {
    initialVotes[`team-${idx + 1}`] = 0;
  });

  const defaultStore: FirestoreStore = {
    votingStarted: false,
    timerRunning: false,
    endTime: null,
    duration: configDuration,
    title: configTitle,
    votes: initialVotes
  };

  const sessionDocRef = doc(db, "sessions", "voting_session");
  await setDoc(sessionDocRef, defaultStore);
  return defaultStore;
}

// Helper to get or initialize session
async function getSessionDoc(): Promise<FirestoreStore> {
  const sessionDocRef = doc(db, "sessions", "voting_session");
  const docSnap = await getDoc(sessionDocRef);

  if (docSnap.exists()) {
    const data = docSnap.data() as FirestoreStore;
    
    // Auto-update config if teams.json changed (optional safety check)
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

// GET handler: returns current status and if client IP has voted
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const store = await getSessionDoc();

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

  // Check if client IP has voted in Firestore
  // Since IP might contain periods/slashes, it is perfectly fine as document ID in Firestore.
  // We sanitize it slightly (replace slashes just in case, though standard IPs don't have them)
  const sanitizedIp = ip.replace(/\//g, "_");
  const ipDocRef = doc(db, "voted_ips", sanitizedIp);
  const ipSnap = await getDoc(ipDocRef);
  const hasVotedFor = ipSnap.exists() ? ipSnap.data().teamId : null;

  return NextResponse.json({
    title: store.title,
    duration: store.duration,
    votingStarted: store.votingStarted,
    timerRunning: store.timerRunning,
    endTime: store.endTime,
    teams: teamsList,
    clientIp: ip,
    hasVoted: !!hasVotedFor,
    votedTeamId: hasVotedFor
  });
}

// POST handler: casts a vote for a team based on client IP
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const body = await req.json();
  const { teamId } = body;

  if (!teamId) {
    return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  }

  const sanitizedIp = ip.replace(/\//g, "_");
  const ipDocRef = doc(db, "voted_ips", sanitizedIp);
  const sessionDocRef = doc(db, "sessions", "voting_session");

  try {
    const result = await runTransaction(db, async (transaction) => {
      // 1. Check if IP has already voted
      const ipSnap = await transaction.get(ipDocRef);
      if (ipSnap.exists()) {
        return { 
          error: `Thiết bị của bạn (IP: ${ip}) đã thực hiện bình chọn trước đó!` 
        };
      }

      // 2. Read session config
      const sessionSnap = await transaction.get(sessionDocRef);
      if (!sessionSnap.exists()) {
        return { error: "Phiên bầu chọn chưa được khởi tạo!" };
      }

      const session = sessionSnap.data() as FirestoreStore;

      if (!session.votingStarted) {
        return { error: "Cuộc bình chọn chưa bắt đầu!" };
      }

      if (session.endTime && Date.now() > session.endTime) {
        return { error: "Thời gian bình chọn đã kết thúc!" };
      }

      // 3. Update vote count
      const updatedVotes = { ...session.votes };
      updatedVotes[teamId] = (updatedVotes[teamId] || 0) + 1;

      // 4. Perform database updates
      transaction.update(sessionDocRef, { votes: updatedVotes });
      transaction.set(ipDocRef, { teamId, votedAt: Date.now() });

      return { success: true };
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      votedTeamId: teamId,
      clientIp: ip
    });

  } catch (err) {
    console.error("Firestore transaction error during vote:", err);
    return NextResponse.json({ error: "Giao dịch cơ sở dữ liệu thất bại!" }, { status: 500 });
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
    
    await updateDoc(sessionDocRef, {
      votingStarted: true,
      timerRunning: true,
      endTime: targetEndTime
    });
  } 
  else if (action === "RESET_ALL") {
    // 1. Reset voting session variables
    const resetVotes: Record<string, number> = {};
    Object.keys(store.votes).forEach(key => {
      resetVotes[key] = 0;
    });

    await updateDoc(sessionDocRef, {
      votingStarted: false,
      timerRunning: false,
      endTime: null,
      votes: resetVotes
    });

    // 2. Clear voted IPs collection in a batch
    try {
      const ipsSnapshot = await getDocs(collection(db, "voted_ips"));
      const batch = writeBatch(db);
      ipsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    } catch (e) {
      console.error("Failed to clear voted_ips collection:", e);
    }
  }
  else if (action === "RESET_VOTES") {
    // 1. Reset votes only
    const resetVotes: Record<string, number> = {};
    Object.keys(store.votes).forEach(key => {
      resetVotes[key] = 0;
    });

    await updateDoc(sessionDocRef, {
      votes: resetVotes
    });

    // 2. Clear IP locks
    try {
      const ipsSnapshot = await getDocs(collection(db, "voted_ips"));
      const batch = writeBatch(db);
      ipsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    } catch (e) {
      console.error("Failed to clear voted_ips collection:", e);
    }
  }
  else if (action === "TOGGLE_TIMER") {
    if (store.endTime) {
      if (store.timerRunning) {
        const timeLeft = Math.max(0, store.endTime - Date.now());
        await updateDoc(sessionDocRef, {
          timerRunning: false,
          endTime: timeLeft
        });
      } else {
        const timeLeft = store.endTime || 0;
        await updateDoc(sessionDocRef, {
          timerRunning: true,
          endTime: Date.now() + timeLeft
        });
      }
    }
  }
  else if (action === "ADJUST_TIMER") {
    const { seconds } = body;
    if (store.endTime) {
      if (store.timerRunning) {
        await updateDoc(sessionDocRef, {
          endTime: store.endTime + seconds * 1000
        });
      } else {
        await updateDoc(sessionDocRef, {
          endTime: Math.max(0, store.endTime + seconds * 1000)
        });
      }
    }
  }
  else if (action === "END_NOW") {
    await updateDoc(sessionDocRef, {
      timerRunning: false,
      endTime: Date.now()
    });
  }

  return NextResponse.json({ success: true });
}
