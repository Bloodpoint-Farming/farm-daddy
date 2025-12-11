import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits, type VoiceState } from 'discord.js';
import { db } from '../db';
import { creatorChannels, tempChannels } from '../db/schema';
import { eq } from 'drizzle-orm';

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
                const isTemp = await db.select().from(tempChannels).where(eq(tempChannels.id, oldState.channelId)).get();
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

            const result = await db.select().from(creatorChannels).where(eq(creatorChannels.id, newState.channelId)).get();

            if (result) {
                try {
                    const member = newState.member;
                    if (!member) return;

                    const parentCategory = newState.channel?.parent;
                    const channelName = result.defaultName.replace('{user}', member.user.username);

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
                        id: newChannel.id,
                        guildId: newState.guild.id,
                        createdAt: new Date().toISOString()
                    });

                    // Send a welcome message in the new channel (text chat)
                    await newChannel.send({
                        content: `Welcome ${member.toString()}! This is your temporary voice channel. You can manage it using the permissions I've given you.`
                    });

                } catch (error) {
                    this.container.logger.error('Error creating temporary channel:', error);
                }
            }
        }
    }
}