const http = require("http");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 3456;
const API_SECRET = process.env.CLIP_API_SECRET || "sports-lore-clips-2026";
const USE_WARP = process.env.USE_WARP !== "false";

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// R2 credentials (set these on the VPS)
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "sports-lore-clips";
const R2_PUBLIC_URL = "https://pub-86aa1c96eda04a8099526017d95dbb8f.r2.dev";

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  if (req.method === "POST" && req.url === "/download-clip") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { videoId, startTime, duration, secret, mirror } =
          JSON.parse(body);
        if (secret !== API_SECRET) {
          res.writeHead(401);
          return res.end(JSON.stringify({ error: "unauthorized" }));
        }
        const clipDir = "/tmp/clips-" + Date.now();
        fs.mkdirSync(clipDir, { recursive: true });
        const clipPath = path.join(clipDir, "clip.mp4");
        const outPath = path.join(clipDir, "out.mp4");
        const start = startTime || 0;
        const dur = duration || 3.5;
        const url = "https://youtube.com/watch?v=" + videoId;

        console.log(
          "Downloading " + videoId + " segment " + start + "s +" + dur + "s",
        );
        const proxyArg = USE_WARP ? " --proxy socks5://127.0.0.1:40000" : "";
        const cookieArg = fs.existsSync("/opt/sports-lore/cookies.txt")
          ? ' --cookies "/opt/sports-lore/cookies.txt"'
          : "";
        const dlCmd =
          "yt-dlp --no-playlist" +
          cookieArg +
          ' -f "best[height<=1080]/best"' +
          " --download-sections" +
          ' "*' +
          formatTime(start) +
          "-" +
          formatTime(start + dur) +
          '"' +
          " --force-keyframes-at-cuts" +
          " --merge-output-format mp4" +
          proxyArg +
          " --socket-timeout 30" +
          " --no-warnings" +
          ' -o "' +
          clipPath +
          '"' +
          ' "' +
          url +
          '"';
        execSync(dlCmd, { timeout: 120000, stdio: "pipe" });

        if (!fs.existsSync(clipPath)) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: "download failed" }));
        }

        // Apply mirror (horizontal flip) if requested
        let finalPath = clipPath;
        if (mirror) {
          console.log("Applying mirror...");
          execSync(
            'ffmpeg -i "' +
              clipPath +
              '" -vf hflip -c:a copy -y "' +
              outPath +
              '"',
            { timeout: 30000, stdio: "pipe" },
          );
          if (fs.existsSync(outPath)) finalPath = outPath;
        }

        const fileData = fs.readFileSync(finalPath);
        console.log(
          "Sending clip: " + (fileData.length / 1024).toFixed(0) + "KB",
        );
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": fileData.length,
        });
        res.end(fileData);
        fs.rmSync(clipDir, { recursive: true, force: true });
      } catch (e) {
        console.error("Error:", e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message.slice(0, 200) }));
      }
    });
  } else if (req.method === "POST" && req.url === "/upload-clip") {
    // Receive raw MP4 body + query params
    const url = new URL(req.url, "http://localhost");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const body = Buffer.concat(chunks);
        // Parse content-type for boundary (multipart) or treat as raw
        const contentType = req.headers["content-type"] || "";

        let clipBuffer, rowId, slot, secret;

        if (contentType.includes("multipart/form-data")) {
          // Simple multipart parser
          const boundary = "--" + contentType.split("boundary=")[1];
          const raw = body.toString("latin1");
          const parts = raw
            .split(boundary)
            .filter((p) => p.includes("Content-Disposition"));

          for (const part of parts) {
            const nameMatch = part.match(/name="([^"]+)"/);
            if (!nameMatch) continue;
            const name = nameMatch[1];
            const valueStart = part.indexOf("\r\n\r\n") + 4;
            const valueEnd = part.lastIndexOf("\r\n");

            if (name === "secret")
              secret = part.substring(valueStart, valueEnd).trim();
            else if (name === "rowId")
              rowId = part.substring(valueStart, valueEnd).trim();
            else if (name === "slot")
              slot = part.substring(valueStart, valueEnd).trim();
            else if (name === "clip")
              clipBuffer = Buffer.from(
                part.substring(valueStart, valueEnd),
                "latin1",
              );
          }
        } else {
          // JSON body with base64
          const json = JSON.parse(body.toString());
          secret = json.secret;
          rowId = json.rowId;
          slot = json.slot;
          clipBuffer = Buffer.from(json.videoBase64, "base64");
        }

        if (secret !== API_SECRET) {
          res.writeHead(401);
          return res.end(JSON.stringify({ error: "unauthorized" }));
        }
        if (!clipBuffer || !rowId || !slot) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "missing clip/rowId/slot" }));
        }

        console.log(
          "Upload: " +
            rowId +
            "/clip_" +
            slot +
            " (" +
            (clipBuffer.length / 1024).toFixed(0) +
            "KB)",
        );

        // Upload to R2 using aws s3 cli
        const tmpFile = "/tmp/upload_" + Date.now() + ".mp4";
        fs.writeFileSync(tmpFile, clipBuffer);

        if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID) {
          const key = rowId + "/clip_" + slot + ".mp4";
          const endpoint =
            "https://" + R2_ACCOUNT_ID + ".r2.cloudflarestorage.com";
          const env =
            "AWS_ACCESS_KEY_ID=" +
            R2_ACCESS_KEY_ID +
            " AWS_SECRET_ACCESS_KEY=" +
            R2_SECRET_ACCESS_KEY;
          const cmd =
            env +
            ' aws s3 cp "' +
            tmpFile +
            '" "s3://' +
            R2_BUCKET +
            "/" +
            key +
            '" --endpoint-url "' +
            endpoint +
            '"';
          try {
            execSync(cmd, { timeout: 30000, stdio: "pipe" });
            const publicUrl = R2_PUBLIC_URL + "/" + key;
            console.log("Uploaded to R2: " + publicUrl);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, url: publicUrl }));
          } catch (e) {
            console.error("R2 upload failed:", e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: "R2 upload failed" }));
          }
        } else {
          // No R2 credentials — save locally
          const localPath = "/tmp/clips/" + rowId;
          fs.mkdirSync(localPath, { recursive: true });
          fs.copyFileSync(tmpFile, localPath + "/clip_" + slot + ".mp4");
          console.log("Saved locally (no R2 credentials)");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              url: "local://" + localPath + "/clip_" + slot + ".mp4",
            }),
          );
        }

        fs.unlinkSync(tmpFile);
      } catch (e) {
        console.error("Upload error:", e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message.slice(0, 200) }));
      }
    });
  } else if (req.method === "POST" && req.url === "/remove-bg") {
    // Remove background from image using rembg
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks);
        const json = JSON.parse(body.toString());
        if (json.secret !== API_SECRET) {
          res.writeHead(401);
          return res.end(JSON.stringify({ error: "unauthorized" }));
        }

        const tmpIn = "/tmp/rembg_in_" + Date.now() + ".png";
        const tmpOut = "/tmp/rembg_out_" + Date.now() + ".png";

        if (json.imageBase64) {
          fs.writeFileSync(tmpIn, Buffer.from(json.imageBase64, "base64"));
        } else if (json.imageUrl) {
          execSync('curl -sL -o "' + tmpIn + '" "' + json.imageUrl + '"', {
            timeout: 15000,
            stdio: "pipe",
          });
        } else {
          res.writeHead(400);
          return res.end(
            JSON.stringify({ error: "imageBase64 or imageUrl required" }),
          );
        }

        if (!fs.existsSync(tmpIn)) {
          res.writeHead(500);
          return res.end(
            JSON.stringify({ error: "failed to save input image" }),
          );
        }

        console.log("Removing background...");
        execSync('rembg i "' + tmpIn + '" "' + tmpOut + '"', {
          timeout: 60000,
          stdio: "pipe",
        });

        if (!fs.existsSync(tmpOut)) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: "rembg failed" }));
        }

        const outData = fs.readFileSync(tmpOut);
        const base64 = outData.toString("base64");
        console.log(
          "Background removed: " + (outData.length / 1024).toFixed(0) + "KB",
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, imageBase64: base64 }));

        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
      } catch (e) {
        console.error("remove-bg error:", e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message.slice(0, 200) }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", warp: USE_WARP }));
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => console.log("Clip API running on port " + PORT));
