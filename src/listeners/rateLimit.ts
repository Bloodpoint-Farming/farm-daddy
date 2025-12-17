import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import type { RateLimitData } from 'discord.js';

@ApplyOptions<Listener.Options>({ event: 'rateLimit' })
export class UserEvent extends Listener {
    public override run(data: RateLimitData) {
        this.container.logger.warn(`[RATE LIMIT] Timeout: ${data.timeToReset}ms | Limit: ${data.limit} | Method: ${data.method} | Path: ${data.route}`);
    }
}
