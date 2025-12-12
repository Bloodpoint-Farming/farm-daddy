import type { GuildMember, User } from 'discord.js';
import { PLATFORMS, type PlatformKey } from './platforms';

/**
 * Formats a channel name based on a template and optional platform.
 * @param template The name template (e.g. "{user}'s Channel")
 * @param user The user (GuildMember or User) to replace {user} with
 * @param platformKey Optional platform key to prepend/modify the name
 * @returns The formatted channel name
 */
export function formatChannelName(template: string, user: GuildMember | User, platformKey?: PlatformKey | null): string {
    let name = template.replace('{user}', user.displayName);

    if (platformKey && PLATFORMS[platformKey]) {
        const platformShortName = PLATFORMS[platformKey].short;
        name = `${platformShortName} ${name}`;
    }

    return name;
}
