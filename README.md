# Stokefire Bot

A Farcaster bot that tracks and broadcasts Stokefire game events in real-time. The bot monitors various in-game activities such as gathering resources, building huts, battles, and more, posting updates to Farcaster as they happen.

## Features

- Real-time monitoring of Stokefire game events
- Posts activity updates to Farcaster
- Supports multiple event types:
  - Resource gathering (food, wood)
  - Building construction
  - Battle events
  - Defense commitments
  - Village raids
- Chronological event ordering
- Persistent event tracking with Redis
- Graceful error handling and shutdown

## Prerequisites

- Node.js >= 18.0.0
- Redis server (or connection URL)
- Neynar API key for Farcaster
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/stokefire-bot.git
cd stokefire-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
# Required: Your Neynar API key for Farcaster
NEYNAR_API_KEY=your_neynar_api_key

# Optional: Redis configuration (defaults shown)
REDIS_URL=redis://red-csbuue08fa8c738qgh1g:6379
```

## Usage

### Development

Run the bot in development mode with hot reloading:
```bash
npm run dev
```

### Production

Build and run the bot in production mode:
```bash
npm run build
npm start
```

## Available Scripts

- `npm run dev` - Run in development mode with hot reloading
- `npm run build` - Build the TypeScript code
- `npm start` - Run the built code in production
- `npm run lint` - Check for linting issues
- `npm run lint:fix` - Fix linting issues automatically
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Run TypeScript type checking
- `npm run clean` - Clean the build directory

## Event Types

The bot tracks and posts the following events:

1. **Gather Food**
   - Format: `@username gathered X food with Y villagers`

2. **Chop Wood**
   - Format: `@username gathered X wood with Y villagers`

3. **Build Hut**
   - Format: `@username built X hut(s)`

4. **Commit Defense**
   - Format: `@username committed their defense`

5. **Attack Village**
   - Format: `@username raided @defender's village, tried to steal X resources`

6. **Reveal Battle**
   - Format: `@username revealed battle. @winner won X resource`

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEYNAR_API_KEY` | Neynar API key for Farcaster | 
| `NEYNAR_SIGNER_UUID` | Neynar Signer key for the bot | 
| `REDIS_URL` | Redis connection URL | 

### Batch Size

The bot processes events in batches. You can adjust the batch size by modifying the `BATCH_SIZE` constant in `src/index.ts` (default: 25).

## Architecture

- TypeScript-based Node.js application
- GraphQL for event data fetching
- Redis for event tracking
- Automated error handling and recovery
- Graceful shutdown handling

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Acknowledgments

- Stokefire game and API
- Neynar for Farcaster API access
- Contributors and maintainers