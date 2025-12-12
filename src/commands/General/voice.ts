import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { EmbedBuilder, Colors } from 'discord.js';
import { db } from '../../db';
import { creatorChannels, tempChannels } from '../../db/schema';
import { eq } from 'drizzle-orm';

@ApplyOptions<Subcommand.Options>({
    name: 'voice',
    description: 'Manage your voice channel',
    subcommands: [
        {
            name: 'limit',
            chatInputRun: 'chatInputLimit'
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
                        .setDescription('Set the user limit for your temporary voice channel')
                        .addIntegerOption((option) =>
                            option
                                .setName('number')
                                .setDescription('The maximum number of users (1-99)')
                                .setRequired(true)
                                .setMinValue(1)
                                .setMaxValue(99)
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
                .setDescription(`User limit is now ${limit}.`)
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

        // Using ephemeral: true because the user request implied a personal warning, though not explicitly requested as ephemeral.
        // However, "respond with a warning embed" typically is visible.
        // Given the previous command was ephemeral (setup), I'll stick to reply() which is public by default unless ephemeral is set.
        // But warning messages are usually ephemeral to not clutter chat. 
        // "If the user is not currently in a VC, respond with a warning embed".
        // I will make it ephemeral to be safe/clean.
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}
