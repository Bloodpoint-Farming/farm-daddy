import type { GuildMember, User } from 'discord.js';
import { PLATFORMS, type PlatformKey } from './platforms';

/**
 * Formats a channel name based on a template and optional platform and build.
 * Supports placeholders: {USER}, {PLATFORM}, {BUILD}
 * Defaults can be specified with :- syntax, e.g. {BUILD:-Farming}
 * @param template The name template (e.g. "{USER}'s {PLATFORM} Channel - {BUILD}")
 * @param user The user (GuildMember or User) to replace {USER} with
 * @param platformKey Optional platform key to replace {PLATFORM} with
 * @param build Optional build string to replace {BUILD} with
 * @returns The formatted channel name
 */
export function formatChannelName(template: string, user: GuildMember | User, platformKey?: PlatformKey | null, build?: string | null): string {
    let name = template;

    // Replace {USER}
    name = name.replace(/\{USER\}/g, user.displayName);

    // Replace {PLATFORM}
    const platformValue = platformKey && PLATFORMS[platformKey] ? PLATFORMS[platformKey].short : '';
    name = name.replace(/\{PLATFORM(?::-(.*?))?\}/g, (_, defaultValue) => platformValue || defaultValue || '');

    // Replace {BUILD}
    name = name.replace(/\{BUILD(?::-(.*?))?\}/g, (_, defaultValue) => build || defaultValue || '');

    return name;
}
