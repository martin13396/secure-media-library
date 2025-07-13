import { Pool } from 'pg';

// Database connection pool
const dbConfig = {
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'media_streaming',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};


const pool = new Pool(dbConfig);

export default pool;

// Helper function to run queries
export async function query(text: string, params?: unknown[]) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    throw error;
  }
}