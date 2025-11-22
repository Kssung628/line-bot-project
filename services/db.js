
import fs from "fs";
import path from "path";
import pkg from "pg";
import axios from "axios";

const { Pool } = pkg;

const jsonPath = path.join(process.cwd(), "data", "users.json");
let pool = null;

if (process.env.POSTGRES_URL) {
  pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });
}

function ensureJson() {
  if (!fs.existsSync(jsonPath)) {
    fs.writeFileSync(jsonPath, JSON.stringify({ users: {} }, null, 2), "utf-8");
  }
}

function readJson() {
  ensureJson();
  return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
}

function writeJson(obj) {
  fs.writeFileSync(jsonPath, JSON.stringify(obj, null, 2), "utf-8");
}

export async function saveUserProfile(userId, profile) {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        profile JSONB,
        updated_at TIMESTAMP DEFAULT now()
      );
    `);
    await pool.query(
      `INSERT INTO users (id, profile)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now();`,
      [userId, profile]
    );
  } else {
    const db = readJson();
    db.users[userId] = profile;
    writeJson(db);
  }

  if (process.env.GSHEET_WEBHOOK) {
    try {
      await axios.post(process.env.GSHEET_WEBHOOK, {
        lineUserId: userId,
        profile
      });
    } catch (e) {
      console.error("Save to Google Sheet failed:", e.message);
    }
  }
}
