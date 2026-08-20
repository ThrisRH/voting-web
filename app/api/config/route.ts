import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    appId: process.env.APP_ID || "",
    callbackUrl: process.env.URL || ""
  });
}
