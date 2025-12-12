import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { EmbedBuilder, Colors } from 'discord.js';
import { db } from '../../db';
import { creatorChannels, tempChannels } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { PLATFORMS, type PlatformKey } from '../../lib/platforms';

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
                                .setDescription('The gaming platform')
                                .setRequired(true)
                                .addChoices(
                                    ...Object.entries(PLATFORMS).map(([key, value]) => ({
                                        name: value.label,
                                        value: key
                                    }))
                                )
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
            await channel.setUserLimit(limit);

            const embed = new EmbedBuilder()
                .setTitle('Updated!')
                .setDescription(`Group limit is now ${limit}.`)
                .setColor(Colors.Green);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to update channel limit. Do I have permissions?', ephemeral: true });
        }
    }

    private async sendAttentionEmbed(interaction: Subcommand.ChatInputCommandInteraction) {
        const creators = await db.select().from(creatorChannels).all();
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
        const isTemp = await db
            .select()
            .from(tempChannels)
            .where(eq(tempChannels.id, BigInt(channel.id)))
            .get();

        if (!isTemp) {
            return this.sendAttentionEmbed(interaction);
        }

        try {
            // Update DB
            await db
                .update(tempChannels)
                .set({ platform: platformKey })
                .where(eq(tempChannels.id, BigInt(channel.id)));

            // Rename Channel
            let newName = channel.name;
            const shortName = PLATFORMS[platformKey].short;
            const statusTag = `[${shortName}]`;

            // Regex to find existing tag like [Steam] or [Xbox]
            const tagRegex = /^\[.*?\]\s*/;
            if (tagRegex.test(newName)) {
                newName = newName.replace(tagRegex, `${statusTag} `);
            } else {
                newName = `${statusTag} ${newName}`;
            }

            await channel.setName(newName);

            const embed = new EmbedBuilder()
                .setTitle('Platform Updated!')
                .setDescription(`Platform set to **${PLATFORMS[platformKey].label}**.`)
                .setColor(Colors.Green);

            return interaction.reply({ embeds: [embed] });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({ content: 'Failed to update platform. Rate limit or permissions?', ephemeral: true });
        }
    }
}
