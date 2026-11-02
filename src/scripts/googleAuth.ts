import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import "../config/env";
import { createOAuthClient, GOOGLE_SCOPES } from "../google/auth";
import { saveToEnv } from "../utils/envFile";

const server = createServer();

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  const client = createOAuthClient(`http://127.0.0.1:${port}`);

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });

  console.log("\nOpen this link in the browser, sign in with the Google account that will own the backup:\n");
  console.log(url);
  console.log("\nWaiting for Google...");

  server.on("request", async (req, res) => {
    const params = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).searchParams;
    const code = params.get("code");
    const error = params.get("error");

    if (!code && !error) {
      res.writeHead(404).end();
      return;
    }

    try {
      if (error) throw new Error(`Google returned: ${error}`);

      const { tokens } = await client.getToken(code!);
      if (!tokens.refresh_token) throw new Error("Google didn't return a refresh token, run the script again");

      saveToEnv("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Done! You can close this tab.</h2>");
      console.log("Saved GOOGLE_REFRESH_TOKEN to .env");
      server.close();
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Something went wrong, check the terminal.</h2>");
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      server.close();
    }
  });
});
