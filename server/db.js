import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = pg;

function buildPgConfigFromUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

function buildPgSsl({ host, url }) {
  if (process.env.PG_CA_CERT_PATH) {
    try {
      const certPath = path.resolve(__dirname, '..', process.env.PG_CA_CERT_PATH);
      const ca = fs.readFileSync(certPath, 'utf8');
      return { rejectUnauthorized: true, ca };
    } catch { /* fall through */ }
  }
  if ((url && url.includes('aivencloud.com')) || (url && url.includes('sslmode=require'))) {
    return { rejectUnauthorized: false };
  }
  if (host && !['localhost', '127.0.0.1'].includes(host)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

const PG_URL = process.env.PG_URL;

export const PG_CONFIG = PG_URL
  ? (() => {
      const base = buildPgConfigFromUrl(PG_URL);
      return {
        ...base,
        max: Number(process.env.PG_POOL_MAX || 10),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
        connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT || 15000),
        ssl: buildPgSsl({ host: base.host, url: PG_URL }),
      };
    })()
  : {
      host: process.env.PG_HOST || '127.0.0.1',
      port: Number(process.env.PG_PORT || 5432),
      database: String(process.env.PG_DATABASE || 'atsdb'),
      user: String(process.env.PG_USER || process.env.USER || 'postgres'),
      password: String(process.env.PG_PASSWORD || ''),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT || 15000),
      ssl: buildPgSsl({ host: process.env.PG_HOST || '127.0.0.1', url: '' }),
    };

export const pool = new Pool(PG_CONFIG);

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

export default pool;
