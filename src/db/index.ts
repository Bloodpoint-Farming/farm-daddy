import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { join } from 'path';
import { rootDir } from '../lib/constants';

const sqlite = new Database(join(rootDir, 'farm.sqlite'));
sqlite.defaultSafeIntegers(true); // BigInt support for discord snowflakes
export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
