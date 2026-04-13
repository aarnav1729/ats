import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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

function buildSsl(host, url) {
  if (process.env.PG_CA_CERT_PATH) {
    try {
      const ca = fs.readFileSync(path.resolve(process.env.PG_CA_CERT_PATH), 'utf8');
      return { rejectUnauthorized: true, ca };
    } catch { /* fall through */ }
  }
  if (url.includes('sslmode=require') || url.includes('aivencloud.com')) {
    return { rejectUnauthorized: false };
  }
  return false;
}

async function seed() {
  const url = process.env.PG_URL;
  if (!url) {
    console.error('PG_URL is not set in .env');
    process.exit(1);
  }

  const pgConfig = buildPgConfigFromUrl(url);
  const ssl = buildSsl(pgConfig.host, url);
  const pool = new Pool({ ...pgConfig, ssl });

  console.log('Seeding database...');

  try {
    // Default admin user
    await pool.query(`
      INSERT INTO users (email, role, name, is_default)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['aarnav.singh@premierenergies.com', 'hr_admin', 'Aarnav Singh', true]);

    console.log('Seed data inserted successfully.');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
