import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type VoiceState } from 'discord.js';
import { db } from '../db';
import { creatorChannels, tempChannels, platformRoles } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { stripIndents } from 'common-tags';
import { PLATFORMS, type PlatformKey } from '../lib/platforms';

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
                    .where(eq(tempChannels.id, BigInt(oldState.channelId)))
                    .get();
                if (isTemp) {
                    try {
                        this.container.logger.debug(`[VoiceStateUpdate] Deleting empty temp channel ${oldState.channelId}`);
                        await oldState.channel.delete();
                        await db.delete(tempChannels).where(eq(tempChannels.id, BigInt(oldState.channelId)));
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
                .where(eq(creatorChannels.id, BigInt(newState.channelId)))
                .get();

            if (result) {
                try {
                    const member = newState.member;
                    if (!member) return;

                    const parentCategory = newState.channel?.parent;
                    let channelName = result.defaultName.replace('{user}', member.user.username);
                    let platformKey: PlatformKey | null = null;

                    // 1. Infer Platform from Roles
                    const userRoleIds = member.roles.cache.map(r => BigInt(r.id));
                    if (userRoleIds.length > 0) {
                        const matches = await db
                            .select()
                            .from(platformRoles)
                            .where(inArray(platformRoles.roleId, userRoleIds))
                            .all();

                        if (matches.length === 1) {
                            // Single match - Auto-use this platform
                            const match = matches[0];
                            const key = match.platform as PlatformKey;
                            if (PLATFORMS[key]) {
                                platformKey = key;
                                const shortName = PLATFORMS[key].short;
                                channelName = `[${shortName}] ${channelName}`;
                            }
                        }
                        // If 0 matches or >1 match, we don't set a default platform automatically
                    }

                    // Create the new voice channel
                    const newChannel = await newState.guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildVoice,
                        parent: parentCategory?.id,
                        permissionOverwrites: [
                            {
                                id: member.id,
                                allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]
                            }
                        ]
                    });

                    // Move the member to the new channel
                    await member.voice.setChannel(newChannel);

                    // Track in DB
                    await db.insert(tempChannels).values({
                        id: BigInt(newChannel.id),
                        guildId: BigInt(newState.guild.id),
                        createdAt: new Date().toISOString(),
                        platform: platformKey // might be null
                    });

                    // Get valid command IDs for clickable links
                    const groupCommand = this.container.client.application?.commands.cache.find((c) => c.name === 'group');
                    const groupLimitAction = groupCommand ? `</group limit:${groupCommand.id}>` : '`/group limit`';
                    const groupPlatformAction = groupCommand ? `</group platform:${groupCommand.id}>` : '`/group platform`';

                    let welcomeContent = stripIndents`Welcome ${member.toString()}!
                    # Commands
                    - ${groupLimitAction} - set VC user limit
                    - ${groupPlatformAction} - set platform`;

                    // Send a welcome message in the new channel (text chat)
                    await newChannel.send({
                        content: welcomeContent
                    });
                } catch (error) {
                    this.container.logger.error('Error creating temporary channel:', error);
                }
            }
        }
    }
}
