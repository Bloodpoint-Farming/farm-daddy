import { type VoiceBasedChannel } from 'discord.js';
import { container } from '@sapphire/framework';
import { db } from '../db';
import { userRules } from '../db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Fetches and posts the group rules for a given owner and creator channel to a text channel.
 * If no rules are defined, posts a default message with a link to settings.
 */
export async function postGroupRules(channel: VoiceBasedChannel, ownerId: bigint, creatorChannelId: bigint) {
    const guildId = BigInt(channel.guildId);

    try {
        const ownerRules = await db
            .select()
            .from(userRules)
            .where(and(
                eq(userRules.userId, ownerId),
                eq(userRules.guildId, guildId),
                eq(userRules.creatorChannelId, creatorChannelId)
            ))
            .get();

        if (ownerRules) {
            await channel.send({
                content: `## Group Rules 📜\n${ownerRules.rules}`,
                allowedMentions: { users: [] }
            });
        } else {
            // Get valid command ID for clickable link
            const settingsCommand = container.client.application?.commands.cache.find((c: any) => c.name === 'settings');
            const settingsAction = settingsCommand ? `</settings:${settingsCommand.id}>` : '`/settings`';

            await channel.send({
                content: `## Group Rules 📜\n- Normal server rules.\n- Customize your group rules in ${settingsAction}!`,
                allowedMentions: { users: [] }
            });
        }
    } catch (error) {
        container.logger.error('[Rules Helper] Error posting group rules:', error);
    }
}
