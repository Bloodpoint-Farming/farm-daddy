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
