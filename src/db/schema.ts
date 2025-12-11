import { sqliteTable, text, customType } from 'drizzle-orm/sqlite-core';

const snowflake = customType<{ data: bigint; driverData: bigint }>({
	dataType() {
		return 'integer';
	},
	fromDriver(value: unknown): bigint {
		return BigInt(value as any);
	},
	toDriver(value: bigint): bigint {
		return value;
	}
});

export const creatorChannels = sqliteTable('creator_channels', {
	// The ID of the voice channel that is designated as a "creator" channel
	id: snowflake('id').primaryKey(),
	// The ID of the guild this channel belongs to
	guildId: snowflake('guild_id').notNull(),
	// The default name template for created temporary channels
	defaultName: text('default_name').notNull().default("{user}'s Channel")
});

export const tempChannels = sqliteTable('temp_channels', {
	// The ID of the temporary voice channel
	id: snowflake('id').primaryKey(),
	// The guild ID
	guildId: snowflake('guild_id').notNull(),
	// Timestamp when created
	createdAt: text('created_at').notNull()
});
