import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { logger } from '../shared/logger.js';

const dbUrl = process.env.DATABASE_URL || 'file:./data/arclight.db';
const dbPath = dbUrl.replace(/^file:/, '');

logger.info({ path: dbPath }, 'Connecting to database');

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
