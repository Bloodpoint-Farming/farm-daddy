CREATE TABLE `creator_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`default_name` text DEFAULT '{user}''s Channel' NOT NULL
);
