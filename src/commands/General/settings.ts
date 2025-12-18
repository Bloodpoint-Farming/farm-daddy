import { Subcommand } from '@sapphire/plugin-subcommands';
import { ApplyOptions } from '@sapphire/decorators';
import { ApplicationCommandRegistry } from '@sapphire/framework';
import {
    ActionRowBuilder,
    EmbedBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    ComponentType,
    Colors
} from 'discord.js';
import { db } from '../../db';
import { users, userTrust, userBlock, tempChannels } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { updateChannelPermissions } from '../../lib/permissions';
import { VoiceChannel } from 'discord.js';
import { stripIndent } from 'common-tags';

@ApplyOptions<Subcommand.Options>({
    name: 'settings',
    description: 'Manage your personal settings',
    subcommands: [
        {
            name: 'view',
            chatInputRun: 'chatInputView',
            default: true
        },
        {
            type: 'group',
            name: 'user',
            entries: [
                {
                    name: 'trust',
                    chatInputRun: 'chatInputTrust'
                },
                {
                    name: 'block',
                    chatInputRun: 'chatInputBlock'
                }
            ]
        },
        {
            name: 'chat',
            chatInputRun: 'chatInputChat'
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
                        .setName('view')
                        .setDescription("View your current settings")
                )
                .addSubcommandGroup((group) =>
                    group
                        .setName('user')
                        .setDescription('Manage your trust and block lists')
                        .addSubcommand((command) =>
                            command
                                .setName('trust')
                                .setDescription('Manage your trusted users')
                        )
                        .addSubcommand((command) =>
                            command
                                .setName('block')
                                .setDescription('Manage your blocked users')
                        )
                )
                .addSubcommand((command) =>
                    command
                        .setName('chat')
                        .setDescription('Control who can chat in your channels')
                )
        );
    }

    public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const userPref = await db
            .select()
            .from(users)
            .where(and(eq(users.userId, BigInt(user.id)), eq(users.guildId, BigInt(guildId))))
            .get();

        const trusted = await db
            .select()
            .from(userTrust)
            .where(and(eq(userTrust.userId, BigInt(user.id)), eq(userTrust.guildId, BigInt(guildId))))
            .all();

        const blocked = await db
            .select()
            .from(userBlock)
            .where(and(eq(userBlock.userId, BigInt(user.id)), eq(userBlock.guildId, BigInt(guildId))))
            .all();

        const chatRestriction = userPref?.chatRestriction || 'always';
        const chatLabel = chatRestriction === 'always' ? '✅ **Accept** messages from outsiders, even when the group is full.' : '🚫 **No messages** from outsiders unless the group has **open spots**.';

        // Get command IDs for links
        const settingsCommand = this.container.client.application?.commands.cache.find((c) => c.name === 'settings');
        const trustCmd = settingsCommand ? `</settings user trust:${settingsCommand.id}>` : '`/settings user trust`';
        const blockCmd = settingsCommand ? `</settings user block:${settingsCommand.id}>` : '`/settings user block`';
        const chatCmd = settingsCommand ? `</settings chat:${settingsCommand.id}>` : '`/settings chat`';

        const description = stripIndent`
        ## ${chatCmd}
        ${chatLabel}

        ## ${trustCmd}
        ${trusted.length} trusted users can run commands in your VC to:
        - ✅ change voice limits
        - ✅ change builds

        ## ${blockCmd}
        ${blocked.length} blocked users are restricted in your VCs:
        - ⛔ cannot join
        - ⛔ cannot chat
        `

        const embed = new EmbedBuilder()
            .setTitle('Your Settings')
            .setColor(Colors.Blue)
            .setDescription(description);
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    public async chatInputTrust(interaction: Subcommand.ChatInputCommandInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const currentTrusted = await db
            .select()
            .from(userTrust)
            .where(and(eq(userTrust.userId, BigInt(user.id)), eq(userTrust.guildId, BigInt(guildId))))
            .all();

        const defaultUsers = currentTrusted.map(t => t.trustedUserId.toString());

        const select = new UserSelectMenuBuilder()
            .setCustomId('settings-user-trust')
            .setPlaceholder('Select users to trust')
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultUsers(defaultUsers.slice(0, 25));

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select);

        const response = await interaction.reply({
            content: 'Select the users you want to trust. Trusted users can always chat in your channels.',
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.UserSelect,
            time: 60_000
        });

        collector.on('collect', async (i) => {
            if (i.customId !== 'settings-user-trust') return;

            const selectedUsers = i.values;
            const now = new Date().toISOString();

            // Logic: delete existing and re-add to persist timestamps for NEW ones? 
            // Or just replace all? Requirement: "Persist timestamps for these entries."
            // This implies if they were already there, we keep the old timestamp?
            // Let's do a more careful update.

            const existingIds = new Set(currentTrusted.map(t => t.trustedUserId.toString()));
            const selectedSet = new Set(selectedUsers);

            // Users to remove
            const toRemove = [...existingIds].filter(id => !selectedSet.has(id));
            // Users to add
            const toAdd = [...selectedSet].filter(id => !existingIds.has(id));

            for (const id of toRemove) {
                await db.delete(userTrust).where(and(
                    eq(userTrust.userId, BigInt(user.id)),
                    eq(userTrust.guildId, BigInt(guildId)),
                    eq(userTrust.trustedUserId, BigInt(id))
                ));
            }

            if (toAdd.length > 0) {
                await db.insert(userTrust).values(toAdd.map(id => ({
                    userId: BigInt(user.id),
                    guildId: BigInt(guildId),
                    trustedUserId: BigInt(id),
                    createdAt: now
                })));
            }

            await i.update({
                content: `Successfully updated your trust list. ${selectedUsers.length} users trusted.`,
                components: []
            });

            // Reapply permissions if owner is in their channel
            const member = interaction.member as import('discord.js').GuildMember;
            const vc = member?.voice.channel;
            if (vc && vc instanceof VoiceChannel) {
                const isOwner = await db.select().from(tempChannels).where(and(eq(tempChannels.id, BigInt(vc.id)), eq(tempChannels.ownerId, BigInt(user.id)))).get();
                if (isOwner) {
                    await updateChannelPermissions(vc);
                }
            }
        });
    }

    public async chatInputBlock(interaction: Subcommand.ChatInputCommandInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const currentBlocked = await db
            .select()
            .from(userBlock)
            .where(and(eq(userBlock.userId, BigInt(user.id)), eq(userBlock.guildId, BigInt(guildId))))
            .all();

        const defaultUsers = currentBlocked.map(b => b.blockedUserId.toString());

        const select = new UserSelectMenuBuilder()
            .setCustomId('settings-user-block')
            .setPlaceholder('Select users to block')
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultUsers(defaultUsers.slice(0, 25));

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select);

        const response = await interaction.reply({
            content: 'Select the users you want to block. Blocked users cannot join your channels.',
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.UserSelect,
            time: 60_000
        });

        collector.on('collect', async (i) => {
            if (i.customId !== 'settings-user-block') return;

            const selectedUsers = i.values;
            const now = new Date().toISOString();

            const existingIds = new Set(currentBlocked.map(b => b.blockedUserId.toString()));
            const selectedSet = new Set(selectedUsers);

            const toRemove = [...existingIds].filter(id => !selectedSet.has(id));
            const toAdd = [...selectedSet].filter(id => !existingIds.has(id));

            for (const id of toRemove) {
                await db.delete(userBlock).where(and(
                    eq(userBlock.userId, BigInt(user.id)),
                    eq(userBlock.guildId, BigInt(guildId)),
                    eq(userBlock.blockedUserId, BigInt(id))
                ));
            }

            if (toAdd.length > 0) {
                await db.insert(userBlock).values(toAdd.map(id => ({
                    userId: BigInt(user.id),
                    guildId: BigInt(guildId),
                    blockedUserId: BigInt(id),
                    createdAt: now
                })));
            }

            await i.update({
                content: `Successfully updated your block list. ${selectedUsers.length} users blocked.`,
                components: []
            });

            // Reapply permissions if owner is in their channel
            const member = interaction.member as import('discord.js').GuildMember;
            const vc = member?.voice.channel;
            if (vc && vc instanceof VoiceChannel) {
                const isOwner = await db.select().from(tempChannels).where(and(eq(tempChannels.id, BigInt(vc.id)), eq(tempChannels.ownerId, BigInt(user.id)))).get();
                if (isOwner) {
                    await updateChannelPermissions(vc);
                }
            }
        });
    }

    public async chatInputChat(interaction: Subcommand.ChatInputCommandInteraction) {
        const { user, guildId } = interaction;
        if (!guildId) return;

        const userPref = await db
            .select()
            .from(users)
            .where(and(eq(users.userId, BigInt(user.id)), eq(users.guildId, BigInt(guildId))))
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

        const response = await interaction.reply({
            content: 'Select who is allowed to chat in your temporary channels.',
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 60_000
        });

        collector.on('collect', async (i) => {
            if (i.customId !== 'settings-chat-restriction') return;

            const newVal = i.values[0];

            await db
                .insert(users)
                .values({
                    userId: BigInt(user.id),
                    guildId: BigInt(guildId),
                    chatRestriction: newVal
                })
                .onConflictDoUpdate({
                    target: [users.userId, users.guildId],
                    set: { chatRestriction: newVal }
                });

            await i.update({
                content: `Chat restriction set to: **${newVal === 'always' ? 'Always allowed' : 'Only when spots open'}**.`,
                components: []
            });

            // Reapply permissions if owner is in their channel
            const member = interaction.member as import('discord.js').GuildMember;
            const vc = member?.voice.channel;
            if (vc && vc instanceof VoiceChannel) {
                const isOwner = await db.select().from(tempChannels).where(and(eq(tempChannels.id, BigInt(vc.id)), eq(tempChannels.ownerId, BigInt(user.id)))).get();
                if (isOwner) {
                    await updateChannelPermissions(vc);
                }
            }
        });
    }
}
