# Stagehand - Telegram Image Queue Bot

A Telegram bot that takes links from supported websites, extracts images, and queues them for posting to a Telegram channel at scheduled intervals.

## Features

- Extract images from various supported websites
- Queue images for scheduled posting
- Customizable posting schedule using cron syntax
- Access control to limit who can use the bot
- Post images with source attribution and link back to original
- Modular design for easy addition of new website scrapers
- Interactive visual queue management with inline buttons

## Supported Websites

- **e621** - Uses OpenGraph scraping and Cheerio DOM parsing to extract images and videos
- **FurAffinity** - Leverages the FA Export API to fetch submission data and direct download links
- **Bluesky** - Uses ATProto API Library with BskyAgent for full support of posts, images, and videos
- **SoFurry** - Utilizes SoFurry's own APIs to fetch and download submissions.
- **Weasyl** - Implements Weasyl's API, you'll need to supply your own API key from [Weasyl](https://www.weasyl.com/)

## Methodology for Supported Sites

### Bluesky
- Uses the official `@atproto/api` library with BskyAgent
- Parses URLs in the format `bsky.app/profile/{handle}/post/{id}`
- Extracts user DIDs and content identifiers
- Supports both image and video content extraction
- Handles thumbnails for video posts
- Works with public posts without requiring authentication
- Processes quoted content and multiple images in a single post

### e621
- Uses Cheerio to parse the HTML DOM of e621 pages
- Extracts media URLs from OpenGraph tags and direct DOM elements
- Handles both image and video content
- Processes and caches media files locally
- Supports fallback methods if primary extraction fails
- Ensures proper URL resolution for relative paths

### FurAffinity
- Extracts submission IDs from URLs in the format `furaffinity.net/view/{id}`
- Uses the ([FAExport](https://github.com/Deer-Spangle/faexport)) ([API](https://faexport.spangle.org.uk/)) to fetch submission data
- Extracts direct download URLs, titles, and artist information
- Handles both image and video content
- Preserves proper attribution and metadata

## Media Caching and Transcoding

Stagehand uses a sophisticated media caching and transcoding system to efficiently handle images and videos from various sources:

### Media Caching

- All downloaded media is cached locally to reduce bandwidth usage and improve performance
- Files are stored in organized directories:
  - `cache/images/` - For static images
  - `cache/videos/` - For original video files
  - `cache/transcoded/` - For processed/transcoded videos
- Filenames are generated using MD5 hashes of source URLs to ensure uniqueness
- Cache is automatically cleaned up, with files older than 15 days (configurable) being removed

### Media Processing

- Content type detection based on HTTP headers and URL patterns
- Intelligent fallback mechanisms if metadata is unavailable
- Special handling for different media sources (e.g., Bluesky API)
- File extension determination from both URL and content type
- Maximum download size limit of 50MB to prevent abuse

### Video Transcoding

- Videos are automatically transcoded to H.264 MP4 format for maximum compatibility with Telegram
- Uses FFmpeg (via fluent-ffmpeg) with optimized settings:
  - H.264 video codec for wide compatibility
  - AAC audio codec at 128kbps
  - Medium preset balancing quality and processing speed
  - CRF 23 for good quality-to-size ratio
  - MP4 container with faststart flag for immediate playback
  - YUV420p pixel format for maximum device compatibility
- Animated GIFs are handled appropriately based on content type

This system ensures that all media is properly optimized before being sent to Telegram, providing reliable playback across all devices while managing bandwidth and storage efficiently.

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
- `/queue` - Show current queue status with interactive management
- `/send` - Post the next image in the queue immediately
- `/schedule [cron]` - Set posting schedule using cron syntax
- `/setcount [number]` - Set number of images per post interval
- `/clear` - Clear the entire queue
- `/cleancache` - Clean expired items from media cache

### Adding Images to Queue

Send a link from any supported website to the bot in a direct message. The bot will extract the image and add it to the queue.

### Interactive Queue Management

The `/queue` command displays an interactive visual interface for managing queued items:

- **Page Navigation**: Browse through the queue using Previous/Next buttons
- **Item Preview**: View a preview of any queued item before it's posted
- **Item Removal**: Remove specific items from the queue with a single click
- **Reordering**: Move any item to the top of the queue to be posted next
- **Pagination**: Easily navigate through pages of queued items

The interface shows important information about each queued item including:
- Item position in queue
- Content type (image or video)
- Title and source website
- Controls for managing each item

## Adding New Website Scrapers

To add support for a new website:

1. Create a new scraper in the `scrapers` directory extending `BaseScraper`
2. Implement the `canHandle` and `extract` methods
3. Register the scraper in `utils/scraperManager.js`

## License

GPL V3

## ToDo List

- [x] ATProto Implementation
- [x] Basic e621 Scraper
- [x] FurAffinity Scraper
- [x] SoFurry Scraper
- [x] Weasyl Scraper
- [x] Interactive Graphical Queue Manager
- [ ] Add perceptual hashing
- [ ] Redo Queue Manager
- [ ] Redo Bluesky Module
- [ ] Redo Telegram Module
- [ ] Redo Discord Module
