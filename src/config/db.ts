import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

console.log("[DEBUG] Database URL loaded:", process.env.DATABASE_URL ? "YES" : "NO");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Mana database ki "Hello" chepdam
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('[DATABASE] Connection Error ❌:', err.message);
    } else {
        console.log('[DATABASE] Successfully connected to PostgreSQL Database! 🧱');
        console.log('[DATABASE] Server Time:', res.rows[0].now);
    }
});

export default pool;