import { readFileSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export const GOOGLE_CLIENT_FILE = process.env.GOOGLE_CLIENT_FILE || "google-oauth-client.json";

interface ClientCredentials {
  client_id: string;
  client_secret: string;
}

function loadClientCredentials(): ClientCredentials {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET };
  }

  const json = JSON.parse(readFileSync(GOOGLE_CLIENT_FILE, "utf8"));
  return json.installed ?? json.web;
}

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  const { client_id, client_secret } = loadClientCredentials();
  return new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
}

export function getGoogleAuth(): OAuth2Client {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("GOOGLE_REFRESH_TOKEN is missing, run: npm run google:auth");

  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
