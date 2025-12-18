import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import { ActionRowBuilder, ChannelType, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder, ComponentType } from 'discord.js';
import { db } from '../../db';
import { creatorChannels, platformRoles, guildStaffRoles } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { PLATFORMS, type PlatformKey } from '../../lib/platforms';

@ApplyOptions<Subcommand.Options>({
    name: 'setup',
    description: 'Setup bot configurations',
    requiredUserPermissions: [PermissionFlagsBits.Administrator],
    subcommands: [
        {
            type: 'group',
            name: 'creator',
            entries: [
                {
                    name: 'create',
                    chatInputRun: 'chatInputCreator'
                },
                {
                    name: 'message',
                    chatInputRun: 'chatInputMessage'
                },
                {
                    name: 'list',
                    chatInputRun: 'chatInputList'
                },
                {
                    name: 'remove',
                    chatInputRun: 'chatInputRemove'
                }
            ]
        },
        {
            name: 'platform',
            chatInputRun: 'chatInputPlatform'
        },
        {
            name: 'staff',
            chatInputRun: 'chatInputStaff'
        }
    ]
})
export class UserCommand extends Subcommand {
    public override registerApplicationCommands(registry: ApplicationCommandRegistry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName(this.name)
                .setDescription(this.description)
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                .addSubcommandGroup((group) =>
                    group
                        .setName('creator')
                        .setDescription('Manage creator channels')
                        .addSubcommand((command) =>
                            command
                                .setName('create')
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
                                        .setDescription('Channel name. Available placeholders: {USER}, {PLATFORM}, {BUILD}. Defaults: {BUILD:-Farming}')
                                        .setRequired(false)
                                )
                                .addIntegerOption((option) =>
                                    option
                                        .setName('limit')
                                        .setDescription('Default user limit (0 for unlimited)')
                                        .setMinValue(0)
                                        .setMaxValue(99)
                                        .setRequired(false)
                                )
                        )
                        .addSubcommand((command) =>
                            command
                                .setName('message')
                                .setDescription('Configure welcome message for a creator channel')
                                .addChannelOption((option) =>
                                    option
                                        .setName('channel')
                                        .setDescription('The creator channel to configure')
                                        .addChannelTypes(ChannelType.GuildVoice)
                                        .setRequired(true)
                                )
                        )
                        .addSubcommand((command) =>
                            command
                                .setName('list')
                                .setDescription('List all configured creator channels')
                        )
                        .addSubcommand((command) =>
                            command
                                .setName('remove')
                                .setDescription('Un-track a creator channel')
                                .addChannelOption((option) =>
                                    option
                                        .setName('channel')
                                        .setDescription('The creator channel to remove')
                                        .addChannelTypes(ChannelType.GuildVoice)
                                        .setRequired(true)
                                )
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
                .addSubcommand((command) =>
                    command
                        .setName('staff')
                        .setDescription('Designate staff roles that are exempt from blocks')
                )
        );
    }

    public async chatInputCreator(interaction: Subcommand.ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel', true);
        const template = interaction.options.getString('template') || "{USER}'s Channel";

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

    public async chatInputMessage(interaction: Subcommand.ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel', true);

        // Verify it is a creator channel
        const data = await db.select().from(creatorChannels).where(eq(creatorChannels.id, BigInt(channel.id))).get();

        if (!data) {
            return interaction.reply({ content: 'That channel is not a configured Creator Channel.', ephemeral: true });
        }

        // Show Modal
        const modal = new ModalBuilder()
            .setCustomId(`setup-message-${channel.id}`)
            .setTitle('Edit Welcome Message');

        const messageInput = new TextInputBuilder()
            .setCustomId('messageInput')
            .setLabel("Welcome Message")
            .setStyle(TextInputStyle.Paragraph)
            .setValue(data.welcomeMessage || "Welcome {OWNER_MENTION}!")
            .setRequired(false) // Allow empty to clear
            .setMaxLength(2000);

        const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);

        // Handle Submission
        try {
            const submission = await interaction.awaitModalSubmit({
                filter: (i) => i.customId === `setup-message-${channel.id}`,
                time: 300_000 // 5 minutes
            });

            const newMessage = submission.fields.getTextInputValue('messageInput');

            await db
                .update(creatorChannels)
                .set({ welcomeMessage: newMessage || null })
                .where(eq(creatorChannels.id, BigInt(channel.id)));

            await submission.reply({
                content: `Welcome message for <#${channel.id}> has been ${newMessage ? 'updated' : 'cleared'}.`,
                ephemeral: true
            });

        } catch (error) {
            // Time out or validation error
            if (!interaction.replied && !interaction.deferred) {
                // Cannot reply if modal was ignored
            }
        }
        return null;
    }

    public async chatInputList(interaction: Subcommand.ChatInputCommandInteraction) {
        const creators = await db.select().from(creatorChannels).where(eq(creatorChannels.guildId, BigInt(interaction.guildId!))).all();

        if (creators.length === 0) {
            return interaction.reply({ content: 'No Creator Channels configured.', ephemeral: true });
        }

        const list = creators.map((c) => `- <#${c.id}> (Template: \`${c.defaultName}\`, Limit: ${c.defaultLimit})`).join('\n');
        return interaction.reply({ content: `**Creator Channels:**\n${list}`, ephemeral: true });
    }

    public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel', true);

        const result = await db.delete(creatorChannels).where(eq(creatorChannels.id, BigInt(channel.id))).returning();

        if (result.length === 0) {
            return interaction.reply({ content: 'That channel was not a configured Creator Channel.', ephemeral: true });
        }

        return interaction.reply({ content: `Successfully removed <#${channel.id}> from Creator Channels.`, ephemeral: true });
    }

    public async chatInputStaff(interaction: Subcommand.ChatInputCommandInteraction) {
        const { guildId } = interaction;
        if (!guildId) return;

        const staffRoles = await db
            .select()
            .from(guildStaffRoles)
            .where(eq(guildStaffRoles.guildId, BigInt(guildId)))
            .all();

        const roleIds = staffRoles.map((r) => r.roleId.toString());

        const select = new RoleSelectMenuBuilder()
            .setCustomId('setup-staff-roles')
            .setPlaceholder('Select staff roles')
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultRoles(roleIds.slice(0, 25));

        const row = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select);

        const response = await interaction.reply({
            content: 'Select the roles that should be exempt from being blocked in temporary channels.',
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.RoleSelect,
            time: 60_000
        });

        collector.on('collect', async (i) => {
            if (i.customId !== 'setup-staff-roles') return;

            const selectedRoles = i.values;

            // Update DB: Delete all and re-insert
            await db.delete(guildStaffRoles).where(eq(guildStaffRoles.guildId, BigInt(guildId)));

            if (selectedRoles.length > 0) {
                await db.insert(guildStaffRoles).values(
                    selectedRoles.map((id) => ({
                        guildId: BigInt(guildId),
                        roleId: BigInt(id)
                    }))
                );
            }

            await i.update({
                content: `Successfully updated staff roles. ${selectedRoles.length} roles designated.`,
                components: []
            });
        });
    }
}

