import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const creatorChannels = sqliteTable('creator_channels', {
	// The ID of the voice channel that is designated as a "creator" channel
	id: text('id').primaryKey(),
	// The ID of the guild this channel belongs to
	guildId: text('guild_id').notNull(),
	// The default name template for created temporary channels
	defaultName: text('default_name').notNull().default('{user}\'s Channel')
});

export const tempChannels = sqliteTable('temp_channels', {
	// The ID of the temporary voice channel
	id: text('id').primaryKey(),
	// The guild ID
	guildId: text('guild_id').notNull(),
	// Timestamp when created
	createdAt: text('created_at').notNull()
});
