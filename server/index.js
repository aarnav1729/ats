import "dotenv/config";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import fs from "fs";
import https from "https";
import path from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import { PG_CONFIG, pool } from "./db.js";
import { ensureSchema } from "./migrations/run.js";
import authRoutes from "./routes/auth.js";
import publicRoutes from "./routes/public.js";
import userRoutes from "./routes/users.js";
import masterRoutes from "./routes/masters.js";
import aopRoutes from "./routes/aop.js";
import requisitionRoutes from "./routes/requisitions.js";
import jobRoutes from "./routes/jobs.js";
import applicationRoutes from "./routes/applications.js";
import interviewRoutes from "./routes/interviews.js";
import candidateRoutes from "./routes/candidates.js";
import auditRoutes from "./routes/audit.js";
import misRoutes from "./routes/mis.js";
import notificationRoutes from "./routes/notifications.js";
import demoRoutes from "./routes/demo.js";
import orgRoutes from "./routes/org.js";
import clearanceRoutes from "./routes/clearance.js";
import timelineRoutes from "./routes/timeline.js";
import requisitionHoldsRoutes from "./routes/requisitionHolds.js";
import candidatePortalRoutes from "./routes/candidatePortal.js";
import tatRoutes from "./routes/tat.js";
import blacklistRoutes from "./routes/blacklist.js";
import triageRoutes from "./routes/triage.js";
import chatRoutes from "./routes/chat.js";
import offersRoutes from "./routes/offers.js";
import ctcChainRoutes from "./routes/ctcChain.js";
import ctcBreakupRoutes from "./routes/ctcBreakup.js";
import remindersService from "./services/reminders.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
const PORT = 51443;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

const clientDir = path.resolve(__dirname, "../client");
const clientDistDir = path.resolve(clientDir, "dist");
const clientIndexPath = path.resolve(clientDistDir, "index.html");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

// Public routes
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);

// Protected routes
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/masters", authMiddleware, masterRoutes);
app.use("/api/aop", authMiddleware, aopRoutes);
app.use("/api/requisitions", authMiddleware, requisitionRoutes);
app.use("/api/jobs", authMiddleware, jobRoutes);
app.use("/api/applications", authMiddleware, applicationRoutes);
app.use("/api/interviews", authMiddleware, interviewRoutes);
app.use("/api/candidates", authMiddleware, candidateRoutes);
app.use("/api/audit", authMiddleware, auditRoutes);
app.use("/api/mis", authMiddleware, misRoutes);
app.use("/api/notifications", authMiddleware, notificationRoutes);
app.use("/api/demo", authMiddleware, demoRoutes);
app.use("/api/org", authMiddleware, orgRoutes);
app.use("/api/candidates", authMiddleware, clearanceRoutes);
app.use("/api/timeline", authMiddleware, timelineRoutes);
app.use("/api/requisition-holds", authMiddleware, requisitionHoldsRoutes);
app.use("/api/candidate-portal", authMiddleware, candidatePortalRoutes);
app.use("/api/tat", authMiddleware, tatRoutes);
app.use("/api/blacklist", authMiddleware, blacklistRoutes);
app.use("/api/triage", authMiddleware, triageRoutes);
app.use("/api/chat", authMiddleware, chatRoutes);
app.use("/api/offers", authMiddleware, offersRoutes);
app.use("/api/ctc-chain", authMiddleware, ctcChainRoutes);
app.use("/api/ctc-breakup", authMiddleware, ctcBreakupRoutes);

// Serve brand assets used by the email templates and the public job page.
app.get("/pel.png", (_req, res) => res.sendFile(path.resolve(__dirname, "../pel.png")));
app.get("/l.png", (_req, res) => res.sendFile(path.resolve(__dirname, "../l.png")));

// Boot the reminder runner (offer expiry, interview T-24h / T-30m, joining day).
remindersService.start();

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (e) {
    res
      .status(500)
      .json({ status: "error", db: "disconnected", error: e.message });
  }
});

app.use(express.static(clientDistDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
    return next();
  }
  if (!fs.existsSync(clientIndexPath)) {
    return res.status(503).send("Client build is not available yet.");
  }
  return res.sendFile(clientIndexPath);
});

function buildClient() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(npmCommand, ["run", "build"], {
      cwd: clientDir,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Client build failed with exit code ${code}`));
    });
  });
}

// ==================== OLLAMA MANAGEMENT ====================

/**
 * Checks if Ollama is installed on the system
 */
function isOllamaInstalled() {
  try {
    const command =
      process.platform === "win32" ? "where ollama" : "which ollama";
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if Ollama service is running and responsive
 */
async function isOllamaRunning() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Checks if the required model is already pulled
 */
async function isModelPulled() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    const data = await res.json();
    const models = data.models || [];
    return models.some(
      (m) => m.name === OLLAMA_MODEL || m.name.startsWith(OLLAMA_MODEL)
    );
  } catch {
    return false;
  }
}

/**
 * Installs Ollama (platform-specific)
 */
async function installOllama() {
  console.log("📦 Ollama not found. Installation required.");

  const platform = process.platform;

  if (platform === "win32") {
    console.log(
      "⚠️  Windows detected. Please install Ollama manually from: https://ollama.com/download/windows"
    );
    console.log("   After installation, restart this application.");
    process.exit(1);
  } else if (platform === "darwin") {
    console.log(
      "⚠️  macOS detected. Please install Ollama manually: brew install ollama"
    );
    console.log("   Or download from: https://ollama.com/download/mac");
    process.exit(1);
  } else {
    // Linux - attempt automatic installation
    console.log("🐧 Linux detected. Attempting automatic installation...");
    try {
      console.log("   Running: curl -fsSL https://ollama.com/install.sh | sh");
      execSync("curl -fsSL https://ollama.com/install.sh | sh", {
        stdio: "inherit",
        timeout: 300000, // 5 minutes
      });
      console.log("✅ Ollama installed successfully");
      return true;
    } catch (err) {
      console.error("❌ Automatic installation failed:", err.message);
      console.log(
        "   Please install manually: curl -fsSL https://ollama.com/install.sh | sh"
      );
      process.exit(1);
    }
  }
}

/**
 * Starts Ollama service in the background
 */
function startOllamaService() {
  return new Promise((resolve, reject) => {
    console.log("🚀 Starting Ollama service...");

    const isWindows = process.platform === "win32";
    const command = isWindows ? "ollama.exe" : "ollama";

    const ollamaProcess = spawn(command, ["serve"], {
      detached: true,
      stdio: "ignore", // Change to 'inherit' to see Ollama logs
    });

    ollamaProcess.on("error", (err) => {
      console.error("❌ Failed to start Ollama:", err.message);
      reject(err);
    });

    ollamaProcess.on("close", (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`⚠️  Ollama process exited with code ${code}`);
      }
    });

    // Detach so it runs independently
    ollamaProcess.unref();

    // Give it time to start
    setTimeout(resolve, 3000);
  });
}

/**
 * Pulls the required Ollama model
 */
async function pullModel() {
  console.log(
    `📥 Pulling model: ${OLLAMA_MODEL} (this may take several minutes)...`
  );

  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "ollama.exe" : "ollama";

    const pullProcess = spawn(command, ["pull", OLLAMA_MODEL], {
      stdio: "inherit", // Show progress
    });

    pullProcess.on("error", (err) => {
      console.error("❌ Failed to pull model:", err.message);
      reject(err);
    });

    pullProcess.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Model ${OLLAMA_MODEL} pulled successfully`);
        resolve();
      } else {
        reject(new Error(`Model pull failed with exit code ${code}`));
      }
    });
  });
}

/**
 * Main Ollama setup function
 */
async function setupOllama() {
  console.log("\n🦙 ========== SETTING UP OLLAMA AI SERVICE ==========");

  // 1. Check if Ollama is installed
  if (!isOllamaInstalled()) {
    await installOllama();
  } else {
    console.log("✅ Ollama is installed");
  }

  // 2. Check if Ollama is running
  const running = await isOllamaRunning();
  if (!running) {
    console.log("🔄 Ollama is not running. Starting service...");
    await startOllamaService();

    // Wait for service to be ready
    let attempts = 0;
    while (attempts < 10) {
      if (await isOllamaRunning()) {
        console.log("✅ Ollama service is now running");
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
      attempts++;
    }
  } else {
    console.log("✅ Ollama service is already running");
  }

  // 3. Check if model is pulled
  const modelExists = await isModelPulled();
  if (!modelExists) {
    console.log(`📦 Model ${OLLAMA_MODEL} not found locally`);
    await pullModel();
  } else {
    console.log(`✅ Model ${OLLAMA_MODEL} is available`);
  }

  console.log("🦙 ========== OLLAMA AI SERVICE READY ==========\n");
}

// ==================== MAIN START FUNCTION ====================

async function start() {
  try {
    // 1. Build the client (skip with SKIP_CLIENT_BUILD=1 for fast restarts)
    if (process.env.SKIP_CLIENT_BUILD === "1") {
      console.log("⏭️  Skipping client build (SKIP_CLIENT_BUILD=1).");
    } else {
      console.log("🔨 Building client application...");
      await buildClient();
      console.log("✅ Client build complete");
    }

    // 2. Setup database schema
    console.log("🗄️  Setting up database schema...");
    await ensureSchema();
    console.log("✅ Database schema ready");

    // 3. Setup Ollama (AI Service) — non-blocking; system runs without it.
    if (process.env.SKIP_OLLAMA === "1") {
      console.log("⏭️  Skipping Ollama setup (SKIP_OLLAMA=1).");
    } else {
      try {
        await setupOllama();
      } catch (err) {
        console.warn(`⚠️  Ollama setup skipped: ${err.message}`);
        console.warn("   (AI parsing + assistant will degrade to fallback. Set SKIP_OLLAMA=1 to silence.)");
      }
    }

    // 4. Start the server.
    //    HTTPS if certs are present (Windows / production with GoDaddy bundle),
    //    HTTP otherwise (dev on Mac/Linux without certs). Toggle with
    //    USE_HTTP=1 to force plain HTTP regardless of certs.
    const certDir = path.join(__dirname, "certs");
    const certFiles = {
      key: path.join(certDir, "mydomain.key"),
      cert: path.join(certDir, "d466aacf3db3f299.crt"),
      ca: path.join(certDir, "gd_bundle-g2-g1.crt"),
    };
    const certsAvailable = Object.values(certFiles).every((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    const useHttp = process.env.USE_HTTP === "1" || !certsAvailable;

    const onListen = (proto) => () => {
      const banner = "═══════════════════════════════════════════════════";
      console.log(banner);
      console.log(`🚀 ${proto.toUpperCase()} server running → ${proto}://localhost:${PORT}`);
      console.log(`🗄️  PostgreSQL → ${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}`);
      console.log(`🦙 Ollama AI → ${OLLAMA_BASE_URL} (Model: ${OLLAMA_MODEL})`);
      console.log(`💻 Platform → ${process.platform} ${process.arch} · Node ${process.version}`);
      console.log(banner);
    };

    if (useHttp) {
      if (!certsAvailable) {
        console.warn(`⚠️  Certs not found in ${certDir}; starting HTTP server.`);
      }
      const http = await import("node:http");
      http.createServer(app).listen(PORT, onListen("http"));
    } else {
      const httpsOptions = {
        key: fs.readFileSync(certFiles.key),
        cert: fs.readFileSync(certFiles.cert),
        ca: fs.readFileSync(certFiles.ca),
      };
      https.createServer(httpsOptions, app).listen(PORT, onListen("https"));
    }
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down gracefully...");
  // Note: Ollama continues running in background (detached)
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down gracefully...");
  process.exit(0);
});

// Start everything
start();
