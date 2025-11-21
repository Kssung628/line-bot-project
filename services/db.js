import fs from 'fs';
import { Pool } from 'pg';

const JSON_DB = '/tmp/line_insurance_db.json';
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function ensureJson(){
  if (!fs.existsSync(JSON_DB)) fs.writeFileSync(JSON_DB, JSON.stringify({customers:{},sessions:{},messages:{}}));
}
function readJson(){ ensureJson(); return JSON.parse(fs.readFileSync(JSON_DB,'utf8')); }
function writeJson(d){ fs.writeFileSync(JSON_DB, JSON.stringify(d,null,2)); }

export async function ensureCustomer(id){
  if (pool){
    await pool.query(`CREATE TABLE IF NOT EXISTS customers (line_user_id TEXT PRIMARY KEY, data JSONB, created_at TIMESTAMP DEFAULT now())`);
    await pool.query(`INSERT INTO customers(line_user_id, data) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, JSON.stringify({})]);
    return;
  }
  const db = readJson();
  if (!db.customers[id]) db.customers[id] = { created_at: new Date().toISOString(), data:{} };
  writeJson(db);
}

export async function saveSession(id, session){
  if (pool){
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (line_user_id TEXT PRIMARY KEY, session JSONB, updated_at TIMESTAMP DEFAULT now())`);
    await pool.query(`INSERT INTO sessions(line_user_id, session) VALUES($1,$2) ON CONFLICT (line_user_id) DO UPDATE SET session = $2, updated_at = now()`, [id, JSON.stringify(session)]);
    return;
  }
  const db = readJson(); db.sessions[id]=session; writeJson(db);
}

export async function getSession(id){
  if (pool){
    const r = await pool.query('SELECT session FROM sessions WHERE line_user_id=$1',[id]);
    return r.rows.length? r.rows[0].session : null;
  }
  const db=readJson(); return db.sessions[id]||null;
}

export async function saveMessage(id, role, content){
  if (pool){
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, line_user_id TEXT, role TEXT, content TEXT, created_at TIMESTAMP DEFAULT now())`);
    await pool.query('INSERT INTO messages(line_user_id, role, content) VALUES($1,$2,$3)', [id, role, content]);
    return;
  }
  const db = readJson();
  if (!db.messages[id]) db.messages[id]=[];
  db.messages[id].push({ role, content, time: new Date().toISOString() });
  writeJson(db);
}
