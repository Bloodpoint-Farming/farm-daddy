import { sqliteTable, text, customType } from 'drizzle-orm/sqlite-core';

// Custom type to handle BigInts with defaultSafeIntegers: true
// This is effectively a pass-through at runtime, but ensures TypeScript knows it's a bigint.
const snowflake = customType<{ data: bigint; driverData: bigint }>({
	dataType() {
		return 'integer';
	},
	fromDriver(value: unknown): bigint {
		return value as bigint;
	},
	toDriver(value: bigint): bigint {
		return value;
	}
});

// Custom type to handle Integers that should be treated as JS numbers
// (better-sqlite3 with defaultSafeIntegers: true returns all INTEGERs as BigInt)
const customInt = customType<{ data: number; driverData: number }>({
	dataType() {
		return 'integer';
	},
	fromDriver(value: unknown): number {
		return Number(value);
	},
	toDriver(value: number): number {
		return value;
	}
});

export const creatorChannels = sqliteTable('creator_channels', {
	// The ID of the voice channel that is designated as a "creator" channel
	id: snowflake('id').primaryKey(),
	// The ID of the guild this channel belongs to
	guildId: snowflake('guild_id').notNull(),
	// The default name template for created temporary channels
	defaultName: text('default_name').notNull().default("{user}'s Channel"),
	// Default user limit for created channels (0 = unlimited). Default to 5.
	defaultLimit: customInt('default_limit').notNull().default(5),
	// Custom welcome message for this creator channel
	welcomeMessage: text('welcome_message')
});

export const tempChannels = sqliteTable('temp_channels', {
	// The ID of the temporary voice channel
	id: snowflake('id').primaryKey(),
	// The guild ID
	guildId: snowflake('guild_id').notNull(),
	// Timestamp when created
	createdAt: text('created_at').notNull(),
	// The platform associated with this channel (e.g. 'steam', 'xbox')
	platform: text('platform')
});

export const platformRoles = sqliteTable('platform_roles', {
	// The Role ID
	roleId: snowflake('role_id').primaryKey(),
	// The Guild ID
	guildId: snowflake('guild_id').notNull(),
	// The platform key (e.g. 'steam', 'xbox')
	platform: text('platform').notNull()
});
