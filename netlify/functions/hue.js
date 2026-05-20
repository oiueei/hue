import { getStore } from "@netlify/blobs";

// Philips Hue easter egg — Netlify serverless port of the original Django
// version (see ../reference-django/hue.py). Controls a Hue light via the Hue
// Cloud API. Tokens are persisted in Netlify Blobs because Hue rotates the
// refresh token on every refresh and serverless functions are stateless.

const HUE_API_BASE = "https://api.meethue.com/route/api";
const TOKEN_URL = "https://api.meethue.com/v2/oauth2/token";

const env = (name, fallback = "") => process.env[name] || fallback;

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lightStateUrl() {
  return `${HUE_API_BASE}/${env("HUE_USERNAME")}/lights/${env("HUE_LIGHT_ID", "3")}/state`;
}

async function getAccessToken(store) {
  let tokens = await store.get("tokens", { type: "json" });

  // Seed from env vars on first run (mirrors _seed_from_env in the Django version).
  if (!tokens || !tokens.refresh_token) {
    const refresh_token = env("HUE_REFRESH_TOKEN");
    if (!refresh_token) return null;
    tokens = {
      access_token: env("HUE_ACCESS_TOKEN"),
      refresh_token,
      expires_at: Number(env("HUE_ACCESS_TOKEN_EXPIRES_AT", "0")),
    };
    await store.setJSON("tokens", tokens);
  }

  const now = Date.now() / 1000;
  if (tokens.access_token && now < tokens.expires_at - 60) {
    return tokens.access_token;
  }

  // Refresh — Hue rotates the refresh token, so persist the new pair.
  const basic = Buffer.from(`${env("HUE_CLIENT_ID")}:${env("HUE_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  const data = await res.json();
  if (res.ok && data.access_token) {
    await store.setJSON("tokens", {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: now + (data.expires_in || 604800),
    });
    return data.access_token;
  }
  return null;
}

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const store = getStore("hue-tokens");

  // Admin: inject a fresh refresh token without a redeploy.
  if (action === "set-refresh-token") {
    const adminKey = env("ADMIN_KEY");
    if (adminKey && url.searchParams.get("key") !== adminKey) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "Missing ?token= parameter" }, 400);
    await store.setJSON("tokens", { access_token: "", refresh_token: token, expires_at: 0 });
    return json({ status: "refresh token updated" });
  }

  const missing = ["HUE_CLIENT_ID", "HUE_CLIENT_SECRET", "HUE_USERNAME"].filter(
    (v) => !process.env[v],
  );
  if (missing.length) return json({ error: `Missing env vars: ${missing.join(", ")}` }, 500);

  const accessToken = await getAccessToken(store);
  if (!accessToken) return json({ error: "Failed to obtain access token" }, 500);
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (action === "trigger") {
    // Hue's native "lselect" blinks the light for ~15s — serverless-friendly,
    // no long-running daemon needed (the Django version used a blink thread).
    await fetch(lightStateUrl(), {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ on: true, bri: 254, alert: "lselect" }),
    });
    return json({ status: "blinking (~15s) — call ?action=stop to stop" });
  }

  if (action === "stop") {
    await fetch(lightStateUrl(), {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ on: false, alert: "none" }),
    });
    return json({ status: "stopped" });
  }

  if (action === "lights") {
    const res = await fetch(`${HUE_API_BASE}/${env("HUE_USERNAME")}/lights`, { headers });
    const data = await res.json();
    const result = {};
    for (const [lid, info] of Object.entries(data)) {
      result[lid] = {
        name: info.name,
        type: info.type,
        on: info.state?.on,
        brightness: info.state?.bri,
        reachable: info.state?.reachable,
      };
    }
    return json(result);
  }

  return json({ error: "Unknown action. Use ?action=trigger|stop|lights" }, 400);
};

export const config = { path: "/api/hue" };
