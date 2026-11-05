// Detects an in-app browser (Instagram, Facebook, WhatsApp …) from the user agent.
// Cookies set inside a webview are not shared with the browser the OAuth handshake
// opens, so a person who joins from one needs the "open in Safari" strip before the
// connector handoff can work.

const NAMED = [
  'instagram',
  'fbav',
  'fban',
  'fb_iab',
  'messenger',
  'whatsapp',
  'line/',
  'micromessenger', // WeChat
  'snapchat',
  'bytedance', // TikTok
  'musical_ly',
  'tiktok',
  'gsa/', // Google Search App
]

// iOS without the Safari token is a webview (UIWebView / WKWebView); Chrome and the
// in-app browsers that share cookies all send a Safari marker.
const IOS = /iphone|ipad|ipod/i

export function looksLikeInAppBrowser(ua: string): boolean {
  const s = ua.toLowerCase()
  if (NAMED.some((t) => s.includes(t))) return true
  return IOS.test(ua) && !s.includes('safari')
}
