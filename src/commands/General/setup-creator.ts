import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '../../db';
import { creatorChannels } from '../../db/schema';

@ApplyOptions<Command.Options>({
	description: 'Setup a voice channel as a Creator Channel',
	requiredUserPermissions: [PermissionFlagsBits.Administrator]
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addChannelOption((option) =>
					option //
						.setName('channel')
						.setDescription('The voice channel to designate')
						.addChannelTypes(ChannelType.GuildVoice)
						.setRequired(true)
				)
				.addStringOption((option) =>
					option //
						.setName('template')
						.setDescription('Default name template (use {user} for username)')
						.setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const channel = interaction.options.getChannel('channel', true);
		const template = interaction.options.getString('template') || "{user}'s Channel";

		if (channel.type !== ChannelType.GuildVoice) {
			return interaction.reply({ content: 'Please select a valid voice channel.', ephemeral: true });
		}

		try {
			await db
				.insert(creatorChannels)
				.values({
					id: BigInt(channel.id),
					guildId: BigInt(interaction.guildId!),
					defaultName: template
				})
				.onConflictDoUpdate({
					target: creatorChannels.id,
					set: { defaultName: template }
				});

			return interaction.reply({
				content: `Successfully set up <#${channel.id}> as a Creator Channel with template: \`${template}\``,
				ephemeral: true
			});
		} catch (error) {
			this.container.logger.error(error);
			return interaction.reply({
				content: 'An error occurred while saving the configuration.',
				ephemeral: true
			});
		}
	}
}
