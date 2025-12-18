import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { EmbedBuilder, Colors } from 'discord.js';
import { db } from '../../db';
import { creatorChannels, tempChannels, users, userTrust, userBlock } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { PLATFORMS, type PlatformKey } from '../../lib/platforms';
import { formatChannelName } from '../../lib/channelName';
import { updateChannelPermissions } from '../../lib/permissions';

@ApplyOptions<Subcommand.Options>({
    name: 'group',
    description: 'Manage your group',
    subcommands: [
        {
            name: 'limit',
            chatInputRun: 'chatInputLimit'
        },
        {
            name: 'platform',
            chatInputRun: 'chatInputPlatform'
        },
        {
            name: 'build',
            chatInputRun: 'chatInputBuild'
        },
        {
            name: 'claim',
            chatInputRun: 'chatInputClaim'
        },
        {
            name: 'transfer',
            chatInputRun: 'chatInputTransfer'
        }
    ]
})
export class UserCommand extends Subcommand {
    public override registerApplicationCommands(registry: ApplicationCommandRegistry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName(this.name)
                .setDescription(this.description)
                .addSubcommand((command) =>
                    command
                        .setName('limit')
                        .setDescription('Set the user limit for your voice channel')
                        .addIntegerOption((option) =>
                            option
                                .setName('number')
                                .setDescription('The maximum number of users (1-99)')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(99)
                        )
                )
                .addSubcommand((command) =>
                    command
                        .setName('platform')
                        .setDescription('Set the platform for your voice group')
                        .addStringOption((option) =>
                            option
                                .setName('platform')
                                .setDescription('All farmers must be on the same platform to match together.')
                                .setRequired(true)
                                .addChoices(
                                    ...Object.entries(PLATFORMS).map(([key, value]) => ({
                                        name: value.label,
                                        value: key
                                    }))
                                )
                        )
                )
                .addSubcommand((command) =>
                    command
                        .setName('build')
                        .setDescription('Set the build for your voice group')
                        .addStringOption((option) =>
                            option
                                .setName('build')
                                .setDescription('The #farming-builds name (e.g. BBDC, R4DC, R4K, etc.)')
                                .setRequired(true)
                        )
                )
                .addSubcommand((command) =>
                    command
                        .setName('claim')
                        .setDescription('Claim ownership of the temporary channel if the owner has left')
                )
                .addSubcommand((command) =>
                    command
                        .setName('transfer')
                        .setDescription('Transfer ownership of your temporary channel to another member')
                        .addUserOption((option) =>
                            option
                                .setName('user')
                                .setDescription('The member to transfer ownership to')
                                .setRequired(true)
                        )
                )
        );
    }

    public async chatInputLimit(interaction: Subcommand.ChatInputCommandInteraction) {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const limit = interaction.options.getInteger('number', true);

        if (!member?.voice.channel) {
            return this.sendAttentionEmbed(interaction);
        }

        const channel = member.voice.channel;

        // Verify it is a tracked temporary channel
        const isTemp = await db
            .select()
            .from(tempChannels)
            .where(eq(tempChannels.id, BigInt(channel.id)))
            .get();

        if (!isTemp) {
            return this.sendAttentionEmbed(interaction);
        }

        if (!(await this.checkPermission(interaction, isTemp.ownerId))) {
            return this.sendNoPermissionEmbed(interaction);
        }

        try {
            const oldLimit = channel.userLimit
            await channel.setUserLimit(limit);

            // Update permissions in case "spots open" status changed
            await updateChannelPermissions(channel as import('discord.js').VoiceChannel);

            // Update user preferences
            await db
                .insert(users)
                .values({
                    userId: BigInt(interaction.user.id),
                    guildId: BigInt(interaction.guildId!),
                    lastLimit: limit
                })
                .onConflictDoUpdate({
                    target: [users.userId, users.guildId],
                    set: { lastLimit: limit }
                });

            const embed = new EmbedBuilder()
                .setDescription(`### Limit ${limit}\n-# Limit changed from **${oldLimit}** to **${limit}**.`)

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to update channel limit. Do I have permissions?', ephemeral: true });
        }
    }

    private async sendAttentionEmbed(interaction: Subcommand.ChatInputCommandInteraction) {
        const creators = await db.select().from(creatorChannels).where(eq(creatorChannels.guildId, BigInt(interaction.guildId!))).all();
        const mentions = creators.map((c) => `<#${c.id}>`).join(', ');

        const embed = new EmbedBuilder()
            .setTitle('Attention!')
            .setDescription(`You are not in a temporary voice channel. Join a creator channel first: ${mentions || 'None available'}.`)
            .setColor(Colors.Yellow);

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    private async checkPermission(interaction: Subcommand.ChatInputCommandInteraction, ownerId: bigint) {
        const { user, guildId } = interaction;
        if (!guildId) return false;

        // Owner can always run commands
        if (BigInt(user.id) === ownerId) return true;

        const ownerPrefs = await db
            .select()
            .from(users)
            .where(and(eq(users.userId, ownerId), eq(users.guildId, BigInt(guildId))))
            .get();

        const restriction = ownerPrefs?.commandRestriction || 'anyone';

        if (restriction === 'owner') return false;

        if (restriction === 'trusted') {
            const isTrusted = await db
                .select()
                .from(userTrust)
                .where(and(
                    eq(userTrust.userId, ownerId),
                    eq(userTrust.guildId, BigInt(guildId)),
                    eq(userTrust.trustedUserId, BigInt(user.id))
                ))
                .get();
            return !!isTrusted;
        }

        if (restriction === 'anyone') {
            const isBlocked = await db
                .select()
                .from(userBlock)
                .where(and(
                    eq(userBlock.userId, ownerId),
                    eq(userBlock.guildId, BigInt(guildId)),
                    eq(userBlock.blockedUserId, BigInt(user.id))
                ))
                .get();
            return !isBlocked;
        }

        return false;
    }

    private async sendNoPermissionEmbed(interaction: Subcommand.ChatInputCommandInteraction) {
        const embed = new EmbedBuilder()
            .setTitle('Permission Denied')
            .setDescription('You do not have permission to run group commands in this channel.')
            .setColor(Colors.Red);

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    public async chatInputPlatform(interaction: Subcommand.ChatInputCommandInteraction) {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const platformKey = interaction.options.getString('platform', true) as PlatformKey;

        if (!member?.voice.channel) {
            return this.sendAttentionEmbed(interaction);
        }

        const channel = member.voice.channel;

        // Verify it is a tracked temporary channel
        const tempChannel = await db
            .select()
            .from(tempChannels)
            .where(eq(tempChannels.id, BigInt(channel.id)))
            .get();

        if (!tempChannel) {
            return this.sendAttentionEmbed(interaction);
        }

        if (!(await this.checkPermission(interaction, tempChannel.ownerId))) {
            return this.sendNoPermissionEmbed(interaction);
        }

        // Fetch the creator channel to get the template
        if (!tempChannel.creatorChannelId) {
            return interaction.reply({
                content: 'Unable to determine the creator channel for this temporary channel.',
                ephemeral: true
            });
        }

        const creatorChannel = await db
            .select()
            .from(creatorChannels)
            .where(eq(creatorChannels.id, tempChannel.creatorChannelId))
            .get();

        if (!creatorChannel) {
            return interaction.reply({
                content: 'Creator channel configuration not found.',
                ephemeral: true
            });
        }

        try {
            // Update DB
            await db
                .update(tempChannels)
                .set({ platform: platformKey })
                .where(eq(tempChannels.id, BigInt(channel.id)));

            // Update user preferences
            await db
                .insert(users)
                .values({
                    userId: BigInt(interaction.user.id),
                    guildId: BigInt(interaction.guildId!),
                    lastPlatform: platformKey
                })
                .onConflictDoUpdate({
                    target: [users.userId, users.guildId],
                    set: { lastPlatform: platformKey }
                });

            // Regenerate channel name from template
            const member = interaction.member as import('discord.js').GuildMember;
            const newName = formatChannelName(creatorChannel.defaultName, member, platformKey, tempChannel.build);
            this.container.logger.debug(`Renaming channel ${channel.id} to ${newName}`);
            await channel.setName(newName);
            this.container.logger.debug(`Renamed channel ${channel.id}`);

            const embed = new EmbedBuilder()
                .setDescription(`Platform set to **${PLATFORMS[platformKey].label}**.`);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to update platform. Rate limit or permissions?', ephemeral: true });
        }
    }

    public async chatInputBuild(interaction: Subcommand.ChatInputCommandInteraction) {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const build = interaction.options.getString('build', true);

        if (!member?.voice.channel) {
            return this.sendAttentionEmbed(interaction);
        }

        const channel = member.voice.channel;

        // Verify it is a tracked temporary channel
        const tempChannel = await db
            .select()
            .from(tempChannels)
            .where(eq(tempChannels.id, BigInt(channel.id)))
            .get();

        if (!tempChannel) {
            return this.sendAttentionEmbed(interaction);
        }

        if (!(await this.checkPermission(interaction, tempChannel.ownerId))) {
            return this.sendNoPermissionEmbed(interaction);
        }

        // Fetch the creator channel to get the template
        if (!tempChannel.creatorChannelId) {
            return interaction.reply({
                content: 'Unable to determine the creator channel for this temporary channel.',
                ephemeral: true
            });
        }

        const creatorChannel = await db
            .select()
            .from(creatorChannels)
            .where(eq(creatorChannels.id, tempChannel.creatorChannelId))
            .get();

        if (!creatorChannel) {
            return interaction.reply({
                content: 'Creator channel configuration not found.',
                ephemeral: true
            });
        }

        try {
            // Update DB
            await db
                .update(tempChannels)
                .set({ build })
                .where(eq(tempChannels.id, BigInt(channel.id)));

            // Update user preferences
            await db
                .insert(users)
                .values({
                    userId: BigInt(interaction.user.id),
                    guildId: BigInt(interaction.guildId!),
                    lastBuild: build
                })
                .onConflictDoUpdate({
                    target: [users.userId, users.guildId],
                    set: { lastBuild: build }
                });

            // Regenerate channel name from template
            const member = interaction.member as import('discord.js').GuildMember;
            const newName = formatChannelName(creatorChannel.defaultName, member, tempChannel.platform as PlatformKey, build);
            this.container.logger.debug(`Renaming channel ${channel.id} to ${newName}`);
            await Promise.race([
                channel.setName(newName),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Channel rename timed out')), 5000))
            ]);
            this.container.logger.debug(`Renamed channel ${channel.id}`);

            const embed = new EmbedBuilder()
                .setDescription(`Build set to **${build}**.`);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to update build. Rate limit or permissions?', ephemeral: true });
        }
    }

    public async chatInputClaim(interaction: Subcommand.ChatInputCommandInteraction) {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!member?.voice.channel) return this.sendAttentionEmbed(interaction);

        const channel = member.voice.channel;
        const tempChannel = await db.select().from(tempChannels).where(eq(tempChannels.id, BigInt(channel.id))).get();
        if (!tempChannel) return this.sendAttentionEmbed(interaction);

        // Check if owner is in the channel
        const ownerInChannel = channel.members.has(tempChannel.ownerId.toString());
        if (ownerInChannel) {
            return interaction.reply({ content: 'You cannot claim this channel while the owner is still present.', ephemeral: true });
        }

        try {
            await db.update(tempChannels).set({ ownerId: BigInt(interaction.user.id) }).where(eq(tempChannels.id, BigInt(channel.id)));
            await updateChannelPermissions(channel as any);

            const embed = new EmbedBuilder()
                .setDescription(`👑 **${interaction.user.username}** has claimed ownership of this channel!`)
                .setColor(Colors.Gold);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to claim channel.', ephemeral: true });
        }
    }

    public async chatInputTransfer(interaction: Subcommand.ChatInputCommandInteraction) {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!member?.voice.channel) return this.sendAttentionEmbed(interaction);

        const channel = member.voice.channel;
        const tempChannel = await db.select().from(tempChannels).where(eq(tempChannels.id, BigInt(channel.id))).get();
        if (!tempChannel) return this.sendAttentionEmbed(interaction);

        if (tempChannel.ownerId !== BigInt(interaction.user.id)) {
            return interaction.reply({ content: 'Only the current owner can transfer ownership.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user', true);
        const targetMember = channel.members.get(targetUser.id);

        if (!targetMember) {
            return interaction.reply({ content: 'The target user must be in the voice channel to receive ownership.', ephemeral: true });
        }

        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ content: 'You are already the owner.', ephemeral: true });
        }

        try {
            await db.update(tempChannels).set({ ownerId: BigInt(targetUser.id) }).where(eq(tempChannels.id, BigInt(channel.id)));
            await updateChannelPermissions(channel as any);

            const embed = new EmbedBuilder()
                .setDescription(`👑 Ownership has been transferred to **${targetUser.username}**!`)
                .setColor(Colors.Gold);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to transfer ownership.', ephemeral: true });
        }
    }
}
