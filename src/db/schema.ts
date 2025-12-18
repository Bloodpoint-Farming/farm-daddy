import { sqliteTable, text, customType, primaryKey } from 'drizzle-orm/sqlite-core';

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
	defaultName: text('default_name').notNull().default("{USER}'s Channel"),
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
	platform: text('platform'),
	// The build associated with this channel
	build: text('build'),
	// The ID of the owner (user who created the channel)
	ownerId: snowflake('owner_id').notNull(),
	// The ID of the creator channel that spawned this temp channel
	creatorChannelId: snowflake('creator_channel_id')
});

export const platformRoles = sqliteTable('platform_roles', {
	// The Role ID
	roleId: snowflake('role_id').primaryKey(),
	// The Guild ID
	guildId: snowflake('guild_id').notNull(),
	// The platform key (e.g. 'steam', 'xbox')
	platform: text('platform').notNull()
});

export const users = sqliteTable('users', {
	// The User ID
	userId: snowflake('user_id').notNull(),
	// The Guild ID
	guildId: snowflake('guild_id').notNull(),
	// Last selected platform
	lastPlatform: text('last_platform'),
	// Last selected limit
	lastLimit: customInt('last_limit'),
	// Last selected build
	lastBuild: text('last_build'),
	// Chat restriction setting
	chatRestriction: text('chat_restriction').notNull().default('always')
}, (table) => ({
	pk: primaryKey({ columns: [table.userId, table.guildId] })
}));

export const userTrust = sqliteTable('user_trust', {
	// The User ID who is trusting someone
	userId: snowflake('user_id').notNull(),
	// The Guild ID
	guildId: snowflake('guild_id').notNull(),
	// The ID of the user being trusted
	trustedUserId: snowflake('trusted_user_id').notNull(),
	// Timestamp when added
	createdAt: text('created_at').notNull()
}, (table) => ({
	pk: primaryKey({ columns: [table.userId, table.guildId, table.trustedUserId] })
}));

export const userBlock = sqliteTable('user_block', {
	// The User ID who is blocking someone
	userId: snowflake('user_id').notNull(),
	// The Guild ID
	guildId: snowflake('guild_id').notNull(),
	// The ID of the user being blocked
	blockedUserId: snowflake('blocked_user_id').notNull(),
	// Timestamp when added
	createdAt: text('created_at').notNull()
}, (table) => ({
	pk: primaryKey({ columns: [table.userId, table.guildId, table.blockedUserId] })
}));

export const guildStaffRoles = sqliteTable('guild_staff_roles', {
	// The Guild ID
	guildId: snowflake('guild_id').notNull(),
	// The Role ID
	roleId: snowflake('role_id').notNull()
}, (table) => ({
	pk: primaryKey({ columns: [table.guildId, table.roleId] })
}));
