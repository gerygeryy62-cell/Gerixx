// ============================================================
// REEL DECK — backend server
// Node.js + Express
//
// WHAT THIS SERVER ACTUALLY DOES:
//   - Accepts a file the user uploads (something they already
//     have the rights to) and converts it to the requested
//     audio/video format using ffmpeg. This is real, working
//     media processing.
//
// WHAT IT DOES NOT DO:
//   - It does not fetch or rip video/audio from YouTube, TikTok,
//     or any other platform. Extracting media from those sites
//     without permission violates their Terms of Service and,
//     in many cases, copyright law. The /api/fetch-url route
//     below is intentionally a stub — see the TODO inside it.
// ============================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "output");
[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory job tracker (fine for a single-instance demo app)
const jobs = new Map();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname) || "";
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const ALLOWED_FORMATS = {
  mp4: { kind: "video", args: ["-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"] },
  webm: { kind: "video", args: ["-c:v", "libvpx-vp9", "-c:a", "libopus"] },
  mp3: { kind: "audio", args: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"] },
  wav: { kind: "audio", args: ["-vn", "-c:a", "pcm_s16le"] },
  aac: { kind: "audio", args: ["-vn", "-c:a", "aac", "-b:a", "192k"] },
  ogg: { kind: "audio", args: ["-vn", "-c:a", "libvorbis", "-q:a", "5"] },
};

// ---------- helpers ----------

function getDurationSeconds(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    ffprobe.stdout.on("data", (d) => (out += d.toString()));
    ffprobe.on("close", () => {
      const val = parseFloat(out.trim());
      resolve(Number.isFinite(val) ? val : null);
    });
    ffprobe.on("error", () => resolve(null));
  });
}

function parseFfmpegTime(line) {
  // ffmpeg progress lines look like: out_time_ms=12345000
  const match = line.match(/out_time_ms=(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10) / 1_000_000; // seconds
}

// ---------- routes ----------

// Real: upload + convert a file the user already has rights to.
app.post("/api/convert", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  const targetFormat = (req.body.format || "").toLowerCase();
  const profile = ALLOWED_FORMATS[targetFormat];
  if (!profile) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({
      error: `Unsupported target format "${targetFormat}". Choose one of: ${Object.keys(ALLOWED_FORMATS).join(", ")}.`,
    });
  }

  const jobId = crypto.randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.${targetFormat}`);
  const originalName = path.parse(req.file.originalname).name;

  jobs.set(jobId, {
    status: "processing",
    progress: 0,
    outputPath: null,
    downloadName: `${originalName}.${targetFormat}`,
    error: null,
  });

  res.json({ jobId });

  const duration = await getDurationSeconds(inputPath);

  const ffArgs = [
    "-y",
    "-i", inputPath,
    ...profile.args,
    "-progress", "pipe:1",
    "-nostats",
    outputPath,
  ];

  const proc = spawn("ffmpeg", ffArgs);

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    for (const line of text.split("\n")) {
      const t = parseFfmpegTime(line);
      if (t !== null && duration) {
        const pct = Math.min(99, Math.round((t / duration) * 100));
        const job = jobs.get(jobId);
        if (job) job.progress = pct;
      }
    }
  });

  let stderrTail = "";
  proc.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  proc.on("close", (code) => {
    const job = jobs.get(jobId);
    if (!job) return;
    fs.unlink(inputPath, () => {});
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      job.outputPath = outputPath;
    } else {
      job.status = "error";
      job.error = "Conversion failed. The source file may be corrupt or use an unsupported codec.";
      console.error("ffmpeg failed:", stderrTail);
    }
  });

  proc.on("error", () => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = "error";
      job.error = "ffmpeg is not available on this server.";
    }
  });
});

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found." });
  res.json({
    status: job.status,
    progress: job.progress,
    error: job.error,
    downloadUrl: job.status === "done" ? `/api/download/${req.params.jobId}` : null,
  });
});

app.get("/api/download/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done" || !job.outputPath) {
    return res.status(404).json({ error: "File not ready or not found." });
  }
  res.download(job.outputPath, job.downloadName);
});

// STUB: pulling media from a platform URL (YouTube, TikTok, etc.)
// This is intentionally not implemented. Scraping/extracting stream
// data from those platforms without authorization violates their
// Terms of Service and can infringe copyright. This route exists so
// the frontend's URL field has somewhere to post to, and so it's
// obvious where a *legitimate* integration would go.
app.post("/api/fetch-url", (req, res) => {
  // TODO: connect your own licensed data source here.
  // Legitimate options include:
  //   - A platform's official API where the rights holder has
  //     explicitly enabled downloads (e.g. a content library you
  //     manage, or a service with a public-domain / CC-licensed
  //     catalog such as the Internet Archive's API).
  //   - A user's own cloud storage (Google Drive, Dropbox) via
  //     their official SDKs, if the media is already theirs.
  // Whatever you connect, it should return a real file or stream
  // that this endpoint then hands to the same /api/convert
  // pipeline above.
  res.status(501).json({
    error:
      "Fetching media directly from platform URLs isn't supported. " +
      "Use the Load Reel panel to upload a file you already have rights to instead.",
  });
});

app.listen(PORT, () => {
  console.log(`Reel Deck running at http://localhost:${PORT}`);
});
      
