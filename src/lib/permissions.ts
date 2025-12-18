import { PermissionFlagsBits, type VoiceChannel, type OverwriteResolvable, OverwriteType } from 'discord.js';
import { db } from '../db';
import { tempChannels, users, userTrust, userBlock, guildStaffRoles } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export async function updateChannelPermissions(channel: VoiceChannel) {
    const guild = channel.guild;
    const guildId = BigInt(guild.id);

    // 1. Fetch channel info to find the owner
    const tempChannel = await db
        .select()
        .from(tempChannels)
        .where(eq(tempChannels.id, BigInt(channel.id)))
        .get();

    if (!tempChannel) return;

    const ownerId = tempChannel.ownerId;

    // 2. Fetch owner's settings
    const ownerSettings = await db
        .select()
        .from(users)
        .where(and(eq(users.userId, ownerId), eq(users.guildId, guildId)))
        .get();

    const trusted = await db
        .select()
        .from(userTrust)
        .where(and(eq(userTrust.userId, ownerId), eq(userTrust.guildId, guildId)))
        .all();

    const blocked = await db
        .select()
        .from(userBlock)
        .where(and(eq(userBlock.userId, ownerId), eq(userBlock.guildId, guildId)))
        .all();

    const staffRoles = await db
        .select()
        .from(guildStaffRoles)
        .where(eq(guildStaffRoles.guildId, guildId))
        .all();

    const trustedIds = new Set(trusted.map((t) => t.trustedUserId.toString()));
    const blockedIds = new Set(blocked.map((b) => b.blockedUserId.toString()));
    const staffRoleIds = new Set(staffRoles.map((s) => s.roleId.toString()));

    const chatRestriction = ownerSettings?.chatRestriction || 'always';
    const limit = channel.userLimit || 0;
    const currentCount = channel.members.size;
    const isFull = limit > 0 && currentCount >= limit;

    // 3. Start with parent category permissions
    const parentCategory = channel.parent;
    const overwrites: OverwriteResolvable[] =
        parentCategory?.permissionOverwrites.cache.map((overwrite) => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
            type: overwrite.type
        })) ?? [];

    // Helper to merge or add an overwrite
    const addOverwrite = (overwrite: OverwriteResolvable) => {
        const index = overwrites.findIndex((o) => o.id === overwrite.id);
        if (index !== -1) {
            overwrites[index] = overwrite;
        } else {
            overwrites.push(overwrite);
        }
    };

    // 4. Blocked users (Staff exempt)
    for (const bId of blockedIds) {
        const member = guild.members.cache.get(bId);
        const isStaff = member?.roles.cache.some((r) => staffRoleIds.has(r.id));

        if (!isStaff) {
            addOverwrite({
                id: bId,
                type: OverwriteType.Member,
                deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages]
            });
        }
    }

    // 5. Trusted users
    for (const tId of trustedIds) {
        addOverwrite({
            id: tId,
            type: OverwriteType.Member,
            allow: [PermissionFlagsBits.SendMessages]
        });
    }

    // 6. Staff Roles (Always allow)
    for (const sRoleId of staffRoleIds) {
        addOverwrite({
            id: sRoleId,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages]
        });
    }

    // 7. Users currently IN the VC
    for (const mId of channel.members.keys()) {
        addOverwrite({
            id: mId,
            type: OverwriteType.Member,
            allow: [PermissionFlagsBits.SendMessages]
        });
    }

    // 8. Dynamic chat restriction for @everyone
    if (chatRestriction === 'open_spots') {
        if (isFull) {
            addOverwrite({
                id: guild.id, // @everyone
                type: OverwriteType.Role,
                deny: [PermissionFlagsBits.SendMessages]
            });
        } else {
            addOverwrite({
                id: guild.id, // @everyone
                type: OverwriteType.Role,
                allow: [PermissionFlagsBits.SendMessages]
            });
        }
    } else {
        // Always allowed
        addOverwrite({
            id: guild.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.SendMessages]
        });
    }

    // 9. Owner always has management permissions
    addOverwrite({
        id: ownerId.toString(),
        type: OverwriteType.Member,
        allow: [
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.SendMessages
        ]
    });

    await channel.permissionOverwrites.set(overwrites);
}
