import { PermissionFlagsBits, type VoiceChannel, type OverwriteResolvable, OverwriteType } from 'discord.js';
import { db } from '../db';
import { tempChannels, users, userTrust, userBlock, guildStaffRoles } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export async function updateChannelPermissions(channel: VoiceChannel) {
    const guild = channel.guild;
    const guildId = guild.id;

    // 1. Fetch channel info to find the owner
    const tempChannel = await db
        .select()
        .from(tempChannels)
        .where(eq(tempChannels.id, channel.id))
        .get();

    if (!tempChannel) return;

    const ownerId = tempChannel.ownerId;

    // 2. Fetch owner's settings and lists
    const [ownerSettings, trusted, blocked, staffRoles] = await Promise.all([
        db.select().from(users).where(and(eq(users.userId, ownerId), eq(users.guildId, guildId))).get(),
        db.select().from(userTrust).where(and(eq(userTrust.userId, ownerId), eq(userTrust.guildId, guildId))).all(),
        db.select().from(userBlock).where(and(eq(userBlock.userId, ownerId), eq(userBlock.guildId, guildId))).all(),
        db.select().from(guildStaffRoles).where(eq(guildStaffRoles.guildId, guildId)).all()
    ]);

    const trustedIds = new Set(trusted.map((t) => t.trustedUserId.toString()));
    const blockedIds = new Set(blocked.map((b) => b.blockedUserId.toString()));
    const staffRoleIds = new Set(staffRoles.map((s) => s.roleId.toString()));

    const chatRestriction = ownerSettings?.chatRestriction || 'always';
    const soundboardRestriction = ownerSettings?.soundboardRestriction || 'anyone';
    const limit = channel.userLimit || 0;
    const isFull = limit > 0 && channel.members.size >= limit;
    const restrictChat = chatRestriction === 'open_spots' && isFull;
    const allowSoundboard = soundboardRestriction === 'anyone';

    // 3. Start with parent category permissions
    const overwrites: OverwriteResolvable[] =
        channel.parent?.permissionOverwrites.cache.map((overwrite) => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
            type: overwrite.type
        })) ?? [];

    // Helper to merge or add an overwrite (last one wins for the same ID)
    const addOverwrite = (id: string, type: OverwriteType, allow: bigint = 0n, deny: bigint = 0n) => {
        const index = overwrites.findIndex((o) => o.id === id);
        if (index !== -1) {
            overwrites[index] = { id, type, allow, deny };
        } else {
            overwrites.push({ id, type, allow, deny });
        }
    };

    // 4. Default Permissions (@everyone)
    // Handle Chat and Soundboard access.
    let everyoneAllow = 0n;
    let everyoneDeny = 0n;

    if (restrictChat) {
        everyoneDeny |= PermissionFlagsBits.SendMessages;
    } else {
        everyoneAllow |= PermissionFlagsBits.SendMessages;
    }

    if (allowSoundboard) {
        everyoneAllow |= PermissionFlagsBits.UseSoundboard | PermissionFlagsBits.UseExternalSounds;
    } else {
        everyoneDeny |= PermissionFlagsBits.UseSoundboard | PermissionFlagsBits.UseExternalSounds;
    }

    addOverwrite(guild.id, OverwriteType.Role, everyoneAllow, everyoneDeny);

    // 5. Trusted User Permissions
    // Trusted users always get Move Members, plus chat access if the channel is full.
    for (const tId of trustedIds) {
        addOverwrite(
            tId,
            OverwriteType.Member,
            PermissionFlagsBits.MoveMembers | PermissionFlagsBits.SendMessages
        );
    }

    // 6. Active Member Exceptions
    // These only need explicit member-level overwrites if @everyone is restricted.
    if (restrictChat) {
        // Members currently in the VC (Don't auto-mute people when the channel fills up)
        for (const mId of channel.members.keys()) {
            // If they are trusted, they already got SendMessages above. 
            // If not, we grant it here so they aren't cut off.
            if (!trustedIds.has(mId)) {
                addOverwrite(mId, OverwriteType.Member, PermissionFlagsBits.SendMessages);
            }
        }
    }

    // 7. Blocked Users (Staff & VC Members exempt)
    // Blocks take priority over trust, so we process them later.
    for (const bId of blockedIds) {
        const member = guild.members.cache.get(bId);
        const isStaff = member?.roles.cache.some((r) => staffRoleIds.has(r.id));
        const isInVC = channel.members.has(bId)

        if (!isStaff && !isInVC) {
            addOverwrite(
                bId,
                OverwriteType.Member,
                0n,
                PermissionFlagsBits.Connect | PermissionFlagsBits.SendMessages
            );
        }
    }

    // 8. Owner (Management Access)
    // Owner always gets SendMessages and management, regardless of restriction.
    addOverwrite(
        ownerId.toString(),
        OverwriteType.Member,
        PermissionFlagsBits.Connect |
        PermissionFlagsBits.ManageChannels |
        PermissionFlagsBits.MoveMembers |
        PermissionFlagsBits.SendMessages
    );

    await channel.permissionOverwrites.set(overwrites);
}
