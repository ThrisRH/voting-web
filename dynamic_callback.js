const fs = require('fs');

const pagePath = 'C:/Users/ADMIN.DESKTOP-FER7TW5/Documents/develop/voting-web/app/page.tsx';
let pageContent = fs.readFileSync(pagePath, 'utf8');

// Modify handleZaloLogin in page.tsx to dynamically generate callbackUrl based on current window location
// This prevents discrepancies between local dev and vercel production URLs.
const target = `  const handleZaloLogin = async () => {
    try {
      // Fetch configurations from backend API to bypass NEXT_PUBLIC_ restriction
      const res = await fetch("/api/config");
      const config = await res.json();
      
      const appId = config.appId;
      const callbackUrl = config.callbackUrl;
      const state = Math.random().toString(36).substring(7);

      if (!appId) {
        alert("Chưa cấu hình Zalo APP_ID! Vui lòng kiểm tra lại cấu hình Biến môi trường trên Vercel.");
        return;
      }

      // Generate PKCE code verifier and challenge
      const codeVerifier = generateRandomString(43);
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // Save code verifier in a temporary cookie so backend callback can fetch it
      document.cookie = \`zalo_code_verifier=\${encodeURIComponent(codeVerifier)}; Path=/; Max-Age=300; SameSite=Lax\`;

      // Redirect to Zalo authorization page with PKCE challenge parameter
      const targetUrl = \`https://oauth.zaloapp.com/v4/permission?app_id=\${appId}&redirect_uri=\${encodeURIComponent(callbackUrl)}&code_challenge=\${codeChallenge}&state=\${state}\`;
      window.location.href = targetUrl;
    } catch (e) {
      console.error(e);
      alert("Không thể kết nối đến máy chủ để lấy cấu hình đăng nhập Zalo!");
    }
  };`.replace(/\r\n/g, '\n');

const replacement = `  const handleZaloLogin = async () => {
    try {
      // Fetch configurations from backend API to bypass NEXT_PUBLIC_ restriction
      const res = await fetch("/api/config");
      const config = await res.json();
      
      const appId = config.appId;
      const state = Math.random().toString(36).substring(7);

      if (!appId) {
        alert("Chưa cấu hình Zalo APP_ID! Vui lòng kiểm tra lại cấu hình Biến môi trường trên Vercel.");
        return;
      }

      // Dynamically derive callback URL based on current window origin to ensure absolute match
      const callbackUrl = \`\${window.location.origin}/api/auth/zalo/callback\`;

      // Generate PKCE code verifier and challenge
      const codeVerifier = generateRandomString(43);
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // Save code verifier in a temporary cookie so backend callback can fetch it
      document.cookie = \`zalo_code_verifier=\${encodeURIComponent(codeVerifier)}; Path=/; Max-Age=300; SameSite=Lax\`;

      // Redirect to Zalo authorization page with PKCE challenge parameter
      const targetUrl = \`https://oauth.zaloapp.com/v4/permission?app_id=\${appId}&redirect_uri=\${encodeURIComponent(callbackUrl)}&code_challenge=\${codeChallenge}&state=\${state}\`;
      window.location.href = targetUrl;
    } catch (e) {
      console.error(e);
      alert("Không thể kết nối đến máy chủ để lấy cấu hình đăng nhập Zalo!");
    }
  };`.replace(/\r\n/g, '\n');

function performReplace(src, target, replacement) {
  let normalizedSrc = src.replace(/\r\n/g, '\n');
  if (normalizedSrc.includes(target)) {
    normalizedSrc = normalizedSrc.replace(target, replacement);
    if (src.includes('\r\n')) {
      return normalizedSrc.replace(/\n/g, '\r\n');
    }
    return normalizedSrc;
  }
  return null;
}

const result = performReplace(pageContent, target, replacement);
if (result) {
  fs.writeFileSync(pagePath, result, 'utf8');
  console.log('Successfully configured dynamic callback URL matching in page.tsx!');
} else {
  console.log('Target handleZaloLogin block was not found.');
}
