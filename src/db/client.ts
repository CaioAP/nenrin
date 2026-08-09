/**
 * The database handle. The only module that opens SQLite.
 *
 * Everything device-shaped in `src/db` sits behind this file; the mappers next door stay
 * free of it so the fiddly translation logic can be tested in plain Node.
 */

import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';

import migrations from '../../drizzle/migrations';
import * as schema from './schema';

export const DATABASE_NAME = 'nenrin.db';

// enableChangeListener is what makes `useLiveQuery` work: lists re-render themselves after a
// write instead of every screen having to remember to refetch.
const sqlite = SQLite.openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

// SQLite ships with foreign keys OFF, per connection. person_group declares ON DELETE
// CASCADE, which is silently ignored without this — leaving orphaned group memberships
// behind every deleted person.
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;

/** The generated migration bundle, re-exported so screens import one module, not two. */
export { migrations };
