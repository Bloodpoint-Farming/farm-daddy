import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ChannelType, type VoiceState, type VoiceChannel, PermissionFlagsBits } from 'discord.js';
import { db } from '../db';
import { creatorChannels, tempChannels, users, platformRoles } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { stripIndents } from 'common-tags';
import type { PlatformKey } from '../lib/platforms';
import { formatChannelName } from '../lib/channelName';
import { updateChannelPermissions } from '../lib/permissions';
import { postGroupRules } from '../lib/rules';

@ApplyOptions<Listener.Options>({
    event: 'voiceStateUpdate'
})
export class UserEvent extends Listener {
    public override async run(oldState: VoiceState, newState: VoiceState) {
        this.container.logger.debug(`[VoiceStateUpdate] User ${newState.member?.user.tag || oldState.member?.user.tag} triggered event.`);

        // Handle Channel Deletion (User Left)
        if (oldState.channelId && oldState.channel) {
            // Check if the channel is empty
            if (oldState.channel.members.size === 0) {
                const isTemp = await db
                    .select()
                    .from(tempChannels)
                    .where(eq(tempChannels.id, oldState.channelId))
                    .get();
                if (isTemp) {
                    try {
                        this.container.logger.debug(`[VoiceStateUpdate] Deleting empty temp channel ${oldState.channelId}`);
                        await oldState.channel.delete();
                        await db.delete(tempChannels).where(eq(tempChannels.id, oldState.channelId));
                    } catch (error) {
                        this.container.logger.error('Error deleting temp channel:', error);
                    }
                }
            }
        }

        // Handle Channel Creation (User Joined)
        if (newState.channelId) {
            // Check bot permissions
            const me = newState.guild.members.me;
            if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
                this.container.logger.warn(`[VoiceStateUpdate] Bot missing ManageChannels permission in guild ${newState.guild.name}.`);
                return;
            }

            // Check if the joined channel is a creator channel
            const result = await db
                .select()
                .from(creatorChannels)
                .where(eq(creatorChannels.id, newState.channelId))
                .get();

            if (result) {
                try {
                    const member = newState.member;
                    if (!member) return;

                    const parentCategory = newState.channel?.parent;

                    // Get user's last settings
                    const userSettings = await db
                        .select()
                        .from(users)
                        .where(and(eq(users.userId, member.id), eq(users.guildId, newState.guild.id)))
                        .get();

                    // Infer platform from user roles if not set in preferences
                    let platformKey: PlatformKey | null = userSettings?.lastPlatform as PlatformKey || null;
                    if (!platformKey) {
                        const userRoles = member.roles.cache.map((r) => r.id);
                        const matchingRoles = await db
                            .select()
                            .from(platformRoles)
                            .where(eq(platformRoles.guildId, newState.guild.id))
                            .all();

                        const matches = matchingRoles.filter((pr) => userRoles.includes(pr.roleId));
                        if (matches.length === 1) {
                            platformKey = matches[0].platform as PlatformKey;
                        }
                    }

                    const build = userSettings?.lastBuild || null;
                    const limit = userSettings?.lastLimit || result.defaultLimit;

                    // Format channel name using helper
                    const channelName = formatChannelName(result.defaultName, member, platformKey, build);

                    // Copy parent category permissions if available
                    const basePermissions = parentCategory?.permissionOverwrites.cache.map((overwrite) => ({
                        id: overwrite.id,
                        allow: overwrite.allow.bitfield,
                        deny: overwrite.deny.bitfield,
                        type: overwrite.type
                    })) ?? [];

                    // Add member-specific permissions on top
                    const permissionOverwrites = [
                        ...basePermissions,
                        {
                            id: member.id,
                            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]
                        }
                    ];

                    const newChannel = await newState.guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildVoice,
                        parent: parentCategory?.id,
                        userLimit: limit,
                        permissionOverwrites
                    });

                    // Move the member to the new channel
                    // Do this first so that the bot feels responsive.
                    member.voice.setChannel(newChannel);

                    // Track in DB FIRST so updateChannelPermissions can find it
                    await db.insert(tempChannels).values({
                        id: newChannel.id,
                        guildId: newState.guild.id,
                        ownerId: member.id,
                        createdAt: new Date().toISOString(),
                        platform: platformKey,
                        build,
                        creatorChannelId: result.id
                    });

                    // Update permissions using helper (handles owner settings, staff roles, and dynamic chat)
                    await updateChannelPermissions(newChannel);

                    // Get valid command IDs for clickable links
                    const settingsCommand = this.container.client.application?.commands.cache.find((c) => c.name === 'settings');
                    const settingsAction = settingsCommand ? `</settings:${settingsCommand.id}>` : '`/settings`';
                    const groupCommand = this.container.client.application?.commands.cache.find((c) => c.name === 'group');
                    const groupLimitAction = groupCommand ? `</group limit:${groupCommand.id}>` : '`/group limit`';
                    const groupPlatformAction = groupCommand ? `</group platform:${groupCommand.id}>` : '`/group platform`';
                    const groupBuildAction = groupCommand ? `</group build:${groupCommand.id}>` : '`/group build`';
                    const groupTransferAction = groupCommand ? `</group transfer:${groupCommand.id}>` : '`/group transfer`';
                    const groupClaimAction = groupCommand ? `</group claim:${groupCommand.id}>` : '`/group claim`';

                    let welcomeContent = "";

                    // Prepend custom welcome message if exists
                    if (result.welcomeMessage) {
                        welcomeContent += result.welcomeMessage.replace('{OWNER_MENTION}', member.toString());
                    } else {
                        welcomeContent += `Welcome ${member.toString()}!`;
                    }

                    welcomeContent += "\n";

                    welcomeContent += stripIndents`
                    ## Settings ⚙️
                    - ${settingsAction} - block & trust users. control chat and command access.
                    ## Ownership 👑
                    - ${groupTransferAction} - pass channel ownership
                    - ${groupClaimAction} - pick up the torch
                    ## Channel 🧑‍🌾
                    - ${groupLimitAction} - set channel size
                    - ${groupPlatformAction} - set the platform you're matching on
                    - ${groupBuildAction} - set your farming method
                    `;

                    // Send a welcome message in the new channel (text chat)
                    await newChannel.send({
                        content: welcomeContent,
                        allowedMentions: { users: [] }
                    });

                    // Post rules
                    await postGroupRules(newChannel, member.id, result.id);
                } catch (error) {
                    this.container.logger.error('Error creating temporary channel:', error);
                }
            }
        }

        // Handle dynamic permission updates for any temporary channel joined/left
        const channelId = newState.channelId || oldState.channelId;
        if (channelId) {
            const channel = newState.guild.channels.cache.get(channelId);
            if (channel?.type === ChannelType.GuildVoice) {
                // We only care if it's a tracked temp channel
                const isTemp = await db.select().from(tempChannels).where(eq(tempChannels.id, channelId)).get();
                if (isTemp) {
                    await updateChannelPermissions(channel as VoiceChannel);
                }
            }
        }
    }
}
