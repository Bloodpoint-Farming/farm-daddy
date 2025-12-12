import { describe, it } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { creatorChannels } from '../../src/db/schema';

describe('BigInt Precision', () => {
    it('should preserve 64-bit integers round-trip', async () => {
        const id = 1448575022439596062n;
        const guildId = 1398084425169895434n;

        // Setup in-memory DB with correct settings
        const sqlite = new Database(':memory:');
        sqlite.defaultSafeIntegers(true);

        const db = drizzle(sqlite);

        // Create table manually
        sqlite.exec(`
            CREATE TABLE creator_channels (
                id INTEGER PRIMARY KEY,
                guild_id INTEGER NOT NULL,
                default_name TEXT NOT NULL
            )
        `);

        // Insert via Drizzle
        await db.insert(creatorChannels).values({
            id: id,
            guildId: guildId,
            defaultName: 'Test'
        });

        // Read back
        const result = await db.select().from(creatorChannels).where(eq(creatorChannels.id, id)).get();

        assert.ok(result);
        if (result) {
            assert.strictEqual(typeof result.id, 'bigint');
            assert.strictEqual(result.id, id);
            assert.strictEqual(result.id.toString(), '1448575022439596062');

            assert.strictEqual(typeof result.guildId, 'bigint');
            assert.strictEqual(result.guildId, guildId);
        }
    });
});
