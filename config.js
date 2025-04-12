require('dotenv').config();
const path = require('path');

module.exports = {
  // Telegram configuration
  botToken: process.env.BOT_TOKEN,
  channelId: process.env.CHANNEL_ID,
  
  // Access control - can be expanded with more user IDs
  authorizedUsers: process.env.AUTHORIZED_USERS ? process.env.AUTHORIZED_USERS.split(',') : [],
  
  // Queue configuration
  defaultCronSchedule: process.env.DEFAULT_CRON_SCHEDULE || '0 */1 * * *', // Default: every hour
  imagesPerInterval: parseInt(process.env.IMAGES_PER_INTERVAL || '1', 10),
  queueFilePath: process.env.QUEUE_FILE_PATH || path.join(__dirname, 'queue', 'queue.json'),
  
  // Media cache configuration
  cacheDir: process.env.CACHE_DIR || path.join(__dirname, 'cache'),
  maxCacheAgeDays: parseInt(process.env.MAX_CACHE_AGE_DAYS || '15', 10),
  
  // Bluesky configuration
  bluesky: {
    service: process.env.BLUESKY_SERVICE || 'https://bsky.social'
  },
  
  // Supported websites for scraping
  supportedSites: [
    {
      name: 'Bluesky',
      domain: 'bsky.app',
      pattern: /^https:\/\/(?:www\.)?bsky\.app\//
    },
    {
      name: 'e621',
      domain: 'e621.net',
      pattern: /^https:\/\/(?:www\.)?e621\.net\//
    },
    {
      name: 'FurAffinity',
      domain: 'furaffinity.net',
      pattern: /^https:\/\/(?:www\.)?furaffinity\.net\//
    },
    {
      name: 'SoFurry',
      domain: 'sofurry.com',
      pattern: /^https:\/\/(?:www\.)?sofurry\.com\//
    },
    {
      name: 'Weasyl',
      domain: 'weasyl.com',
      pattern: /^https:\/\/(?:www\.)?weasyl\.com\//
    }
  ]
};