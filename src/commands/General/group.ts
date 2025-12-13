import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { EmbedBuilder, Colors } from 'discord.js';
import { db } from '../../db';
import { creatorChannels, tempChannels, users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { PLATFORMS, type PlatformKey } from '../../lib/platforms';
import { formatChannelName } from '../../lib/channelName';

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

        try {
            const oldLimit = channel.userLimit
            await channel.setUserLimit(limit);

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
            await channel.setName(newName);

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
            await channel.setName(newName);

            const embed = new EmbedBuilder()
                .setDescription(`Build set to **${build}**.`);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to update build. Rate limit or permissions?', ephemeral: true });
        }
    }
}
