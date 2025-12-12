import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '../../db';
import { creatorChannels, platformRoles } from '../../db/schema';
import { PLATFORMS, type PlatformKey } from '../../lib/platforms';

@ApplyOptions<Subcommand.Options>({
    name: 'setup',
    description: 'Setup bot configurations',
    requiredUserPermissions: [PermissionFlagsBits.Administrator],
    subcommands: [
        {
            name: 'creator',
            chatInputRun: 'chatInputCreator'
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
                        .setName('creator')
                        .setDescription('Setup a voice channel as a Creator Channel')
                        .addChannelOption((option) =>
                            option
                                .setName('channel')
                                .setDescription('The voice channel to designate')
                                .addChannelTypes(ChannelType.GuildVoice)
                                .setRequired(true)
                        )
                        .addStringOption((option) =>
                            option
                                .setName('template')
                                .setDescription('Default name template (use {user} for username)')
                                .setRequired(false)
                        )
                )
                .addSubcommand((command) =>
                    command
                        .setName('platform')
                        .setDescription('Associate a platform with a role')
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
                        .addRoleOption((option) =>
                            option
                                .setName('role')
                                .setDescription('The role to associate with this platform')
                                .setRequired(true)
                        )
                )
        );
    }

    public async chatInputCreator(interaction: Subcommand.ChatInputCommandInteraction) {
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

    public async chatInputPlatform(interaction: Subcommand.ChatInputCommandInteraction) {
        const platformKey = interaction.options.getString('platform', true) as PlatformKey;
        const role = interaction.options.getRole('role', true);

        try {
            await db
                .insert(platformRoles)
                .values({
                    roleId: BigInt(role.id),
                    guildId: BigInt(interaction.guildId!),
                    platform: platformKey
                })
                .onConflictDoUpdate({
                    target: platformRoles.roleId,
                    set: { platform: platformKey }
                });

            const platformLabel = PLATFORMS[platformKey].label;
            return interaction.reply({
                content: `Successfully associated **${platformLabel}** with role ${role.toString()}.`,
                ephemeral: true
            });
        } catch (error) {
            this.container.logger.error(error);
            return interaction.reply({
                content: 'An error occurred while saving the platform role.',
                ephemeral: true
            });
        }
    }
}
