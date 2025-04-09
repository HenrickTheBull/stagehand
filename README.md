# Stagehand - Telegram Image Queue Bot

A Telegram bot that takes links from supported websites, extracts images, and queues them for posting to a Telegram channel at scheduled intervals.

## Features

- Extract images from various supported websites
- Queue images for scheduled posting
- Customizable posting schedule using cron syntax
- Access control to limit who can use the bot
- Post images with source attribution and link back to original
- Modular design for easy addition of new website scrapers

## Supported Websites

- e621 (Using e621 API with rate limit)
- FurAffinity
- SoFurry
- Weasyl
- Bluesky (Uses ATProto API Library)

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   cp .env.example .env
   ```
4. Edit the `.env` file with your Telegram bot token and channel ID
5. Ensure PM2 is installed globally:
   ```
   npm install -g pm2
   ```

## Environment Variables

- `BOT_TOKEN`: Your Telegram bot token from BotFather
- `CHANNEL_ID`: Your Telegram channel ID or username (e.g., @mychannel)
- `AUTHORIZED_USERS`: Comma-separated list of Telegram user IDs that are allowed to use the bot

## Running the Bot

This bot uses PM2 by default to ensure it runs persistently and automatically restarts after crashes or system reboots.

### Starting the bot
```bash
npm start
```

### Stopping the bot
```bash
npm run stop
```

### Restarting the bot
```bash
npm run restart
```

### Viewing logs
```bash
npm run logs
```

### Checking status
```bash
npm run status
```

### Setting up automatic startup on system boot
```bash
pm2 startup
```
Then follow the instructions provided by the command.

### Saving the current PM2 process list
After starting your bot, run:
```bash
pm2 save
```
This ensures your bot restarts automatically if the system reboots.

### Development mode
For development with auto-reload on file changes:
```bash
npm run dev
```

### Commands

- `/start` - Start the bot
- `/help` - Show help information
- `/queue` - Show current queue status
- `/test` - Post the next image in the queue immediately
- `/schedule [cron]` - Set posting schedule using cron syntax
- `/setcount [number]` - Set number of images to post per interval
- `/clear` - Clear the entire queue

### Adding Images to Queue

Send a link from any supported website to the bot in a direct message. The bot will extract the image and add it to the queue.

## Bluesky Implementation

Stagehand includes full support for Bluesky posts using ATProtocol. The implementation:

- Uses the `@atproto/api` library with BskyAgent
- Parses Bluesky URLs in the format `bsky.app/profile/{handle}/post/{id}`
- Extracts user DIDs and content identifiers
- Supports both image and video content extraction
- Handles thumbnails for video posts
- Works with public posts without requiring authentication

All Bluesky content is fetched through the official ATProtocol APIs respecting rate limits.

## Adding New Website Scrapers

To add support for a new website:

1. Create a new scraper in the `scrapers` directory extending `BaseScraper`
2. Implement the `canHandle` and `extract` methods
3. Register the scraper in `utils/scraperManager.js`

## License

ISC