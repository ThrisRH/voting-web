import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "../../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";

const CONFIG_FILE_PATH = path.join(process.cwd(), "public", "teams.json");

export async function GET(req: NextRequest) {
  try {
    let configTitle = "O.TECH Bình Chọn";
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
      console.error("Error reading teams.json:", err);
    }

    const initialVotes: Record<string, number> = {};
    configTeams.forEach((_, idx) => {
      initialVotes[`team-${idx + 1}`] = 0;
    });

    const resetData = {
      votingStarted: false,
      timerRunning: false,
      endTime: null,
      pausedTimeLeft: configDuration,
      duration: configDuration,
      title: configTitle,
      votes: initialVotes,
      votedIps: {},
      votedDevices: {},
      voterTokens: {},
      resetTimestamp: Date.now(),
    };

    const sessionDocRef = doc(db, "sessions", "voting_session");
    await setDoc(sessionDocRef, resetData);

    return NextResponse.json({
      success: true,
      message: "✅ Đã reset toàn bộ dữ liệu bình chọn & đăng xuất Host thành công!",
      resetAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Reset error:", err);
    return NextResponse.json({ success: false, error: "Lỗi khi reset dữ liệu!" }, { status: 500 });
  }
}
