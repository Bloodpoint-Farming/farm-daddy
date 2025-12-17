## Developing

### Stack

- Language: TypeScript
- Packages: [pNpm](https://pnpm.io/)
- Discord: [Sapphire](https://www.sapphirejs.dev/) + [Discord.js](https://github.com/discordjs/discord.js)
- Persistence: [https://sqlite.org/SQLite] + [Drizzle ORM](https://orm.drizzle.team/)
- Runtime: node

## Commands

| Command | Description |
| -- | -- |
| `pnpm install` | download and setup all node_modules |
| `pnpm build` | compile the TypeScript code to JS. Outputs to `dist/`. |
| `pnpm db:push` | Sync the [schema.ts](src/db/schema.ts) directly to the DB without migrations. |
| `pnpm start` | Runs the bot, although you probably want to use an IDE and debugger instead (e.g. [VS Code: launch.json](.vscode/launch.json)). |

## Discord Test Server
1. Create your own discord server for testing.
2. Create your own bot at https://discord.com/developers/applications. Configure:
    - Installation
        - Installation Contexts
            - ✅ Guild Install
        - Default Install Settings
            - Scopes: `bot`
            - Permissions `Administrator` (it only needs to have all the permissions that it will assign to others, but admin is fine for test servers.)
3. Add the bot your server using the Installation > Install Link
4. Copy [.env](https://github.com/Bloodpoint-Farming/bloodpoint-farming-embeds/blob/main/.env) to `.env.local`. Fill in your DISCORD_TOKEN (Bot > Reset Token) in `.env.local`.
5. Start the bot.
6. Use the /setup commands to configure channels, platform roles, etc.