import { Command, ApplicationCommandRegistry } from '@sapphire/framework';
import { ApplyOptions } from '@sapphire/decorators';
import {
    ActionRowBuilder,
    EmbedBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    Colors,
    ButtonBuilder,
    ButtonStyle,
    MessageComponentInteraction,
    UserSelectMenuInteraction,
    StringSelectMenuInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction
} from 'discord.js';
import { db } from '../../db';
import { users, userTrust, userBlock, tempChannels, creatorChannels, userRules } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { updateChannelPermissions } from '../../lib/permissions';
import { stripIndent } from 'common-tags';

@ApplyOptions<Command.Options>({
    name: 'settings',
    description: 'Manage settings for your VCs'
})
export class UserCommand extends Command {
    public override registerApplicationCommands(registry: ApplicationCommandRegistry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName(this.name)
                .setDescription(this.description)
        );
    }

    public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const renderDashboard = async () => {
            const userPref = await db
                .select()
                .from(users)
                .where(and(eq(users.userId, user.id), eq(users.guildId, guildId)))
                .get();

            const trusted = await db
                .select()
                .from(userTrust)
                .where(and(eq(userTrust.userId, user.id), eq(userTrust.guildId, guildId)))
                .all();

            const blocked = await db
                .select()
                .from(userBlock)
                .where(and(eq(userBlock.userId, user.id), eq(userBlock.guildId, guildId)))
                .all();

            const chatRestriction = userPref?.chatRestriction || 'always';
            const chatLabel = chatRestriction === 'always'
                ? '✅ **Accept** messages from outsiders, even when the group is full.'
                : '🚫 **No messages** from outsiders unless the group has **open spots**.';

            const cmdRestriction = userPref?.commandRestriction || 'anyone';
            let cmdLabel = '';
            if (cmdRestriction === 'anyone') cmdLabel = '✅ **Anyone** can run `/group` commands (except blocked users).';
            else if (cmdRestriction === 'trusted') cmdLabel = '🔒 Only **trusted users** can run `/group` commands.';
            else cmdLabel = '👑 Only **you** can run `/group` commands.';

            const soundboardRestriction = userPref?.soundboardRestriction || 'anyone';
            const soundboardLabel = soundboardRestriction === 'anyone'
                ? '✅ **Anyone** can use the soundboard.'
                : '🚫 **Nobody** can use the soundboard (except you).';

            const description = stripIndent`
            ## Chat from Outsiders
            ${chatLabel}

            ## Command Access
            ${cmdLabel}

            ## Soundboard
            ${soundboardLabel}

            ## Trust List
            ${trusted.length} trusted users can always chat and join your VC even when full.

            ## Block List
            ${blocked.length} blocked users cannot join or chat.
            `

            const embed = new EmbedBuilder()
                .setTitle('Your Settings')
                .setColor(Colors.Blue)
                .setDescription(description);

            const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('settings-btn-chat')
                    .setLabel('Chat Settings')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('settings-btn-cmd')
                    .setLabel('Command Access')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('settings-btn-soundboard')
                    .setLabel('Soundboard')
                    .setStyle(ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('settings-btn-trust')
                    .setLabel('Manage Trust')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('settings-btn-block')
                    .setLabel('Manage Blocks')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('settings-btn-rules')
                    .setLabel('Manage Rules')
                    .setStyle(ButtonStyle.Secondary)
            );

            return { content: '', embeds: [embed], components: [row1, row2] };
        };

        const response = await interaction.reply({
            ...(await renderDashboard()),
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            time: 300_000 // 5 minutes
        });

        collector.on('collect', async (i) => {
            try {
                if (i.user.id !== user.id) {
                    await i.reply({ content: 'Only the command user can interact with this menu.', ephemeral: true });
                    return;
                }

                if (i.customId === 'settings-btn-trust') {
                    await this.handleTrust(i);
                } else if (i.customId === 'settings-btn-block') {
                    await this.handleBlock(i);
                } else if (i.customId === 'settings-btn-chat') {
                    await this.handleChat(i);
                } else if (i.customId === 'settings-btn-cmd') {
                    await this.handleCommandAccess(i);
                } else if (i.customId === 'settings-btn-soundboard') {
                    await this.handleSoundboard(i);
                } else if (i.customId === 'settings-btn-rules') {
                    await this.handleRules(i);
                } else if (i.customId === 'settings-btn-back') {
                    await i.update(await renderDashboard());
                } else if (i.isUserSelectMenu()) {
                    await this.handleUserSelect(i);
                } else if (i.isStringSelectMenu()) {
                    await this.handleStringSelect(i);
                }
            } catch (error) {
                this.container.logger.error('[Settings] Error in dashboard collector:', error);
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
                }
            }
        });
    }

    private async handleTrust(interaction: MessageComponentInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const currentTrusted = await db
            .select()
            .from(userTrust)
            .where(and(eq(userTrust.userId, user.id), eq(userTrust.guildId, guildId)))
            .all();

        const select = new UserSelectMenuBuilder()
            .setCustomId('settings-user-trust')
            .setPlaceholder('Select users to trust')
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultUsers(currentTrusted.map(t => t.trustedUserId.toString()).slice(0, 25));

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select);
        const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({
            content: 'Trusted users can always chat and join your VC even when full.',
            embeds: [],
            components: [row, backBtn]
        });
    }

    private async handleBlock(interaction: MessageComponentInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const currentBlocked = await db
            .select()
            .from(userBlock)
            .where(and(eq(userBlock.userId, user.id), eq(userBlock.guildId, guildId)))
            .all();

        const select = new UserSelectMenuBuilder()
            .setCustomId('settings-user-block')
            .setPlaceholder('Select users to block')
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultUsers(currentBlocked.map(b => b.blockedUserId.toString()).slice(0, 25));

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select);
        const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({
            content: 'Blocked users cannot join your channels or send messages.',
            embeds: [],
            components: [row, backBtn]
        });
    }

    private async handleChat(interaction: MessageComponentInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const userPref = await db
            .select()
            .from(users)
            .where(and(eq(users.userId, user.id), eq(users.guildId, guildId)))
            .get();

        const currentVal = userPref?.chatRestriction || 'always';

        const select = new StringSelectMenuBuilder()
            .setCustomId('settings-chat-restriction')
            .setPlaceholder('Choose chat restriction')
            .addOptions([
                {
                    label: 'Always allowed',
                    value: 'always',
                    description: 'Anyone can chat in the VC text channel.',
                    default: currentVal === 'always'
                },
                {
                    label: 'Only when spots open',
                    value: 'open_spots',
                    description: 'Only allows chatting if the VC has empty spots.',
                    default: currentVal === 'open_spots'
                }
            ]);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({
            content: 'Select when outsiders can send messages in your temporary channels.',
            embeds: [],
            components: [row, backBtn]
        });
    }

    private async handleCommandAccess(interaction: MessageComponentInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const userPref = await db
            .select()
            .from(users)
            .where(and(eq(users.userId, user.id), eq(users.guildId, guildId)))
            .get();

        const currentVal = userPref?.commandRestriction || 'anyone';

        const select = new StringSelectMenuBuilder()
            .setCustomId('settings-cmd-restriction')
            .setPlaceholder('Choose command access')
            .addOptions([
                {
                    label: 'Anyone',
                    value: 'anyone',
                    description: 'Anyone can run /group commands (except blocked users).',
                    default: currentVal === 'anyone'
                },
                {
                    label: 'Trusted',
                    value: 'trusted',
                    description: 'Only you and your trusted users can run /group commands.',
                    default: currentVal === 'trusted'
                },
                {
                    label: 'Only You',
                    value: 'owner',
                    description: 'Only you can run /group commands in your VC.',
                    default: currentVal === 'owner'
                }
            ]);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({
            content: 'Select who may run `/group` commands in your temporary channels.',
            embeds: [],
            components: [row, backBtn]
        });
    }

    private async handleSoundboard(interaction: MessageComponentInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const userPref = await db
            .select()
            .from(users)
            .where(and(eq(users.userId, user.id), eq(users.guildId, guildId)))
            .get();

        const currentVal = userPref?.soundboardRestriction || 'anyone';

        const select = new StringSelectMenuBuilder()
            .setCustomId('settings-soundboard-restriction')
            .setPlaceholder('Choose soundboard access')
            .addOptions([
                {
                    label: 'Anyone',
                    value: 'anyone',
                    description: 'Anyone can use soundboards and external sounds.',
                    default: currentVal === 'anyone'
                },
                {
                    label: 'Only Me',
                    value: 'owner',
                    description: 'Nobody else can use soundboards.',
                    default: currentVal === 'owner'
                }
            ]);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({
            content: 'Select who may use Soundboards in your temporary channels. This applies to everyone, including trusted users.',
            embeds: [],
            components: [row, backBtn]
        });
    }

    private async handleUserSelect(interaction: UserSelectMenuInteraction) {
        const { user, guildId, customId, values } = interaction;
        if (!guildId) return;

        // Filter out self
        const filteredValues = values.filter(id => id !== user.id);
        const now = new Date().toISOString();

        if (customId === 'settings-user-trust') {
            const current = await db.select().from(userTrust).where(and(eq(userTrust.userId, user.id), eq(userTrust.guildId, guildId))).all();
            const existingIds = new Set(current.map(t => t.trustedUserId.toString()));
            const selectedSet = new Set(filteredValues);

            const toRemove = [...existingIds].filter(id => !selectedSet.has(id));
            const toAdd = [...selectedSet].filter(id => !existingIds.has(id));

            for (const id of toRemove) {
                await db.delete(userTrust).where(and(eq(userTrust.userId, user.id), eq(userTrust.guildId, guildId), eq(userTrust.trustedUserId, id)));
            }
            if (toAdd.length > 0) {
                for (const id of toAdd) {
                    // Remove from block list if being added to trust list
                    await db.delete(userBlock).where(and(eq(userBlock.userId, user.id), eq(userBlock.guildId, guildId), eq(userBlock.blockedUserId, id)));
                    await db.insert(userTrust).values({ userId: user.id, guildId: guildId, trustedUserId: id, createdAt: now });
                }
            }
            await this.finalizeUpdate(interaction, 'Trust List');
        } else if (customId === 'settings-user-block') {
            const current = await db.select().from(userBlock).where(and(eq(userBlock.userId, user.id), eq(userBlock.guildId, guildId))).all();
            const existingIds = new Set(current.map(b => b.blockedUserId.toString()));
            const selectedSet = new Set(filteredValues);

            const toRemove = [...existingIds].filter(id => !selectedSet.has(id));
            const toAdd = [...selectedSet].filter(id => !existingIds.has(id));

            for (const id of toRemove) {
                await db.delete(userBlock).where(and(eq(userBlock.userId, user.id), eq(userBlock.guildId, guildId), eq(userBlock.blockedUserId, id)));
            }
            if (toAdd.length > 0) {
                for (const id of toAdd) {
                    // Remove from trust list if being added to block list
                    await db.delete(userTrust).where(and(eq(userTrust.userId, user.id), eq(userTrust.guildId, guildId), eq(userTrust.trustedUserId, id)));
                    await db.insert(userBlock).values({ userId: user.id, guildId: guildId, blockedUserId: id, createdAt: now });
                }
            }
            await this.finalizeUpdate(interaction, 'Block List');
        }
    }

    private async handleRules(interaction: MessageComponentInteraction) {
        const { guildId } = interaction;
        if (!guildId) return;

        const creators = await db.select().from(creatorChannels).where(eq(creatorChannels.guildId, guildId)).all();

        if (creators.length === 0) {
            return interaction.update({
                content: 'There are no Creator Channels configured in this server. Admins must set them up using `/setup creator add`.',
                embeds: [],
                components: [
                    new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId('settings-rules-select')
            .setPlaceholder('Pick a channel to edit rules for');

        for (const c of creators) {
            const channel = interaction.guild?.channels.cache.get(c.id.toString());
            const label = channel ? `#${channel.name}` : `Channel ${c.id}`;
            select.addOptions({
                label,
                value: c.id.toString(),
                description: `Default Name: ${c.defaultName}`
            });
        }

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: 'Select which Category you want to define rules for. These rules will be posted when you own a channel in this category.',
            embeds: [],
            components: [row, backBtn]
        });
    }

    private async handleStringSelect(interaction: StringSelectMenuInteraction) {
        const { user, guildId, customId, values } = interaction;
        if (!guildId) return;

        if (customId === 'settings-chat-restriction') {
            const newVal = values[0];
            await db.insert(users).values({ userId: user.id, guildId: guildId, chatRestriction: newVal })
                .onConflictDoUpdate({ target: [users.userId, users.guildId], set: { chatRestriction: newVal } });

            await this.finalizeUpdate(interaction, 'Chat Restriction');
            return;
        } else if (customId === 'settings-cmd-restriction') {
            const newVal = values[0];
            await db.insert(users).values({ userId: user.id, guildId: guildId, commandRestriction: newVal })
                .onConflictDoUpdate({ target: [users.userId, users.guildId], set: { commandRestriction: newVal } });

            await this.finalizeUpdate(interaction, 'Command Access');
            return;
        } else if (customId === 'settings-soundboard-restriction') {
            const newVal = values[0];
            await db.insert(users).values({ userId: user.id, guildId: guildId, soundboardRestriction: newVal })
                .onConflictDoUpdate({ target: [users.userId, users.guildId], set: { soundboardRestriction: newVal } });

            await this.finalizeUpdate(interaction, 'Soundboard Settings');
            return;
        } else if (customId === 'settings-rules-select') {
            const creatorId = values[0];

            // Fetch existing rules
            const currentRulesData = await db
                .select()
                .from(userRules)
                .where(and(
                    eq(userRules.userId, user.id),
                    eq(userRules.guildId, guildId),
                    eq(userRules.creatorChannelId, creatorId)
                ))
                .get();

            const modal = new ModalBuilder()
                .setCustomId(`settings-modal-rules-${creatorId}`)
                .setTitle('Edit Group Rules');

            const rulesInput = new TextInputBuilder()
                .setCustomId('rulesInput')
                .setLabel("Rules (Markdown supported)")
                .setStyle(TextInputStyle.Paragraph)
                .setValue(currentRulesData?.rules || "")
                .setPlaceholder("Be nice! No rushing!")
                .setRequired(false)
                .setMaxLength(1000);

            const row = new ActionRowBuilder<TextInputBuilder>().addComponents(rulesInput);
            modal.addComponents(row);

            await interaction.showModal(modal);

            try {
                const submission = await interaction.awaitModalSubmit({
                    filter: (i) => i.customId === `settings-modal-rules-${creatorId}`,
                    time: 300_000
                });

                const rules = submission.fields.getTextInputValue('rulesInput');

                if (!rules) {
                    await db
                        .delete(userRules)
                        .where(and(
                            eq(userRules.userId, user.id),
                            eq(userRules.guildId, guildId),
                            eq(userRules.creatorChannelId, creatorId)
                        ));
                } else {
                    await db
                        .insert(userRules)
                        .values({
                            userId: user.id,
                            guildId: guildId,
                            creatorChannelId: creatorId,
                            rules
                        })
                        .onConflictDoUpdate({
                            target: [userRules.userId, userRules.guildId, userRules.creatorChannelId],
                            set: { rules }
                        });
                }

                await this.finalizeUpdate(submission, 'Group Rules');
            } catch (err) {
                // Modal timed out or other error
            }
            return;
        }
        return;
    }

    private async finalizeUpdate(interaction: MessageComponentInteraction | ModalSubmitInteraction, label: string) {
        const { user } = interaction;
        const options = {
            content: `✅ Successfully updated your **${label}**.`,
            embeds: [],
            components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder().setCustomId('settings-btn-back').setLabel('Back to Dashboard').setStyle(ButtonStyle.Success)
                )
            ]
        };

        if (interaction.isMessageComponent()) {
            await interaction.update(options);
        } else {
            await interaction.reply({ ...options, ephemeral: true });
        }

        // Reapply permissions if owner is in their channel
        const member = interaction.member as import('discord.js').GuildMember;
        const vc = member?.voice.channel;
        if (vc && vc.isVoiceBased()) {
            const isOwner = await db.select().from(tempChannels).where(and(eq(tempChannels.id, vc.id), eq(tempChannels.ownerId, user.id))).get();
            if (isOwner) {
                await updateChannelPermissions(vc as any);
            }
        }
    }
}
