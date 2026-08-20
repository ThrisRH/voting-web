import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const appId = process.env.APP_ID || "";
  const appSecret = process.env.SECRET || "";
  const callbackUrl = process.env.URL || "";

  try {
    // Retrieve the code_verifier from the client cookie
    const codeVerifier = req.cookies.get("zalo_code_verifier")?.value || "";

    // 1. Exchange authorization code for access token
    const tokenRes = await fetch("https://oauth.zaloapp.com/v4/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        secret_key: appSecret
      },
      body: new URLSearchParams({
        code: code,
        app_id: appId,
        grant_type: "authorization_code",
        code_verifier: codeVerifier
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Zalo Token Exchange Error:", tokenData);
      return NextResponse.json({ error: "Failed to exchange Zalo token", details: tokenData }, { status: 400 });
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch User Profile using access token
    const profileRes = await fetch("https://graph.zalo.me/v2.0/me?fields=id,name,picture", {
      method: "GET",
      headers: {
        access_token: accessToken
      }
    });

    const profileData = await profileRes.json();
    if (!profileRes.ok || !profileData.id) {
      console.error("Zalo Profile Fetch Error:", profileData);
      return NextResponse.json({ error: "Failed to fetch Zalo profile" }, { status: 400 });
    }

    // Extract user profile information
    const userSession = {
      id: profileData.id,
      name: profileData.name || "Zalo User",
      avatar: profileData.picture?.data?.url || ""
    };

    // 3. Serialize and set secure cookies to authenticate user session on client side
    const origin = req.nextUrl.origin;
    const response = NextResponse.redirect(origin);
    response.cookies.set("zalo_user", JSON.stringify(userSession), {
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      httpOnly: false, // Allow client side to read it easily for UI display
      sameSite: "lax"
    });
    // Delete the temporary PKCE verifier cookie
    response.cookies.delete("zalo_code_verifier");

    return response;
  } catch (err) {
    console.error("Zalo Auth Callback internal error:", err);
    return NextResponse.json({ error: "Internal Auth Callback Server Error" }, { status: 500 });
  }
}
