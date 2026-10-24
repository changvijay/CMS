import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

// SSL mode detection for cloud providers (Aiven, Render, Neon, Supabase)
const useSsl =
  process.env.PGSSLMODE === 'require' ||
  (process.env.PGHOST && process.env.PGHOST.includes('aivencloud.com')) ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require'));

const sslOption = useSsl ? { rejectUnauthorized: false } : false;

// PostgreSQL Pool configuration
const poolConfig = process.env.DATABASE_URL
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: sslOption,
    max: 5,
    connectionTimeoutMillis: 15000,
  }
  : {
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'cms_db',
    ssl: sslOption,
    max: 5,
    connectionTimeoutMillis: 15000,
  };

let isDbConnected = false;
let dbLastError = null;

export const pool = new Pool(poolConfig);

// Handle idle pool connection errors gracefully to prevent container crashes on startup
pool.on('error', (err) => {
  console.warn('⚠️ Unexpected error on PostgreSQL pool connection:', err.message);
  isDbConnected = false;
  dbLastError = err.message;
});

// Dynamic in-memory store for fallback mode when database is not initialized
const memoryDb = {
  users: [],
  instagram_accounts: [],
  youtube_accounts: [],
};

export async function initDb() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database successfully!');
    isDbConnected = true;
    dbLastError = null;

    // Run schema.sql script to ensure tables exist
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(sql);
      console.log('✅ PostgreSQL Schema verified/initialized.');
    }
    client.release();
  } catch (err) {
    console.warn(
      '⚠️ PostgreSQL connection status:',
      err.message,
      '\n👉 Note: Operating in fallback mode.'
    );
    isDbConnected = false;
    dbLastError = err.message;
  }
}

export function getDbStatus() {
  return {
    connected: isDbConnected,
    mode: isDbConnected ? 'PostgreSQL' : 'Disconnected / Memory Mode',
    error: isDbConnected ? null : dbLastError,
    config: {
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || '5432',
      database: process.env.PGDATABASE || 'cms_db',
      has_user: Boolean(process.env.PGUSER),
      has_password: Boolean(process.env.PGPASSWORD),
    },
  };
}

// Database helper methods
export async function findUserByUsernameOrEmail(identifier) {
  if (isDbConnected) {
    const query = `
      SELECT * FROM users 
      WHERE username = $1 OR email_address = $1 
      LIMIT 1
    `;
    const res = await pool.query(query, [identifier]);
    return res.rows[0] || null;
  } else {
    return (
      memoryDb.users.find(
        (u) =>
          u.username.toLowerCase() === identifier.toLowerCase() ||
          u.email_address.toLowerCase() === identifier.toLowerCase()
      ) || null
    );
  }
}

export async function findUserById(id) {
  if (isDbConnected) {
    const query = `SELECT id, username, email_address, phone_number, is_active, created_at FROM users WHERE id = $1`;
    const res = await pool.query(query, [parseInt(id, 10)]);
    return res.rows[0] || null;
  } else {
    const u = memoryDb.users.find((user) => user.id === parseInt(id, 10));
    if (!u) return null;
    const { password_hash, ...userInfo } = u;
    return userInfo;
  }
}

export async function updateUserPassword(userId, newPasswordHash) {
  if (isDbConnected) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      newPasswordHash,
      userId,
    ]);
  } else {
    const u = memoryDb.users.find((user) => user.id === parseInt(userId, 10));
    if (u) u.password_hash = newPasswordHash;
  }
}

export async function getInstagramAccountsByUserId(userId) {
  if (isDbConnected) {
    const query = `
      SELECT id, page_name, access_token, page_id, created_at 
      FROM instagram_accounts 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const res = await pool.query(query, [parseInt(userId, 10)]);
    return res.rows;
  } else {
    return memoryDb.instagram_accounts.filter(
      (acc) => acc.user_id === parseInt(userId, 10)
    );
  }
}

export async function getYoutubeAccountsByUserId(userId) {
  if (isDbConnected) {
    const query = `
      SELECT id, user_id, channel_name, access_token, playlist_id, created_at 
      FROM Youtube_accounts 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const res = await pool.query(query, [parseInt(userId, 10)]);
    return res.rows;
  } else {
    return memoryDb.youtube_accounts.filter(
      (acc) => acc.user_id === parseInt(userId, 10)
    );
  }
}

export async function getDataFromTable(tableName, userId) {
  const safeTable = tableName === 'Youtube_accounts' ? 'Youtube_accounts' : 'instagram_accounts';
  if (isDbConnected) {
    const query = `SELECT * FROM ${safeTable} WHERE user_id = $1 ORDER BY created_at DESC`;
    const res = await pool.query(query, [parseInt(userId, 10)]);
    return res.rows;
  } else {
    const key = safeTable.toLowerCase();
    return (memoryDb[key] || []).filter((acc) => acc.user_id === parseInt(userId, 10));
  }
}

export function isDbReady() {
  return isDbConnected;
}

export async function getAllInstagramAccounts() {
  if (!isDbConnected) return [];
  const res = await pool.query('SELECT id, user_id, page_name, access_token, page_id FROM instagram_accounts');
  return res.rows;
}

export async function getAllYoutubeAccounts() {
  if (!isDbConnected) return [];
  const res = await pool.query('SELECT id, user_id, channel_name, access_token, playlist_id FROM Youtube_accounts');
  return res.rows;
}
