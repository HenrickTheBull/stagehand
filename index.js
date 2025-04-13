require('dotenv').config();
const StagehandBot = require('./bot/telegramBot');
const DiscordWebhook = require('./bot/discordWebhook');
const queueManager = require('./queue/queueManager');
const mediaCache = require('./utils/mediaCache');
const updater = require('./utils/updater');

// Check if required environment variables are set
if (!process.env.BOT_TOKEN) {
  console.error('Error: BOT_TOKEN environment variable is not set');
  process.exit(1);
}

if (!process.env.CHANNEL_ID) {
  console.error('Error: CHANNEL_ID environment variable is not set');
  process.exit(1);
}

let telegramBot;
let discordWebhook;

// Initialize the bots and services
try {
  // Initialize media cache first
  console.log('Initializing media cache...');
  
  // Initialize the Telegram bot
  telegramBot = new StagehandBot();
  console.log('Stagehand Telegram bot started successfully');
  console.log(`Posting to Telegram channel: ${process.env.CHANNEL_ID}`);
  
  // Initialize Discord webhook if enabled
  discordWebhook = DiscordWebhook;
  if (discordWebhook.isEnabled()) {
    console.log('Discord webhook integration enabled');
  }
  
  // Start the scheduler with both posting services
  const postFunctions = {
    telegram: telegramBot.postMedia.bind(telegramBot),
    discord: discordWebhook.postMedia.bind(discordWebhook)
  };
  queueManager.startScheduler(postFunctions);
  console.log('Post scheduler started');
  
  // Start the auto-updater
  updater.start();
  
  // Handle termination signals for graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    
    try {
      // Save queue state
      await queueManager.shutdown();
      console.log('Queue state saved successfully');
      
      // Clean up the media cache
      if (mediaCache.shutdown) {
        await mediaCache.shutdown();
        console.log('Media cache shutdown complete');
      }
      
      // Stop the auto-updater
      updater.stop();
      console.log('Auto-updater stopped');
      
      // Telegram bot cleanup
      if (telegramBot && telegramBot.shutdown) {
        await telegramBot.shutdown();
      }
      
      // Discord webhook cleanup
      if (discordWebhook && discordWebhook.shutdown) {
        await discordWebhook.shutdown();
      }
      
      console.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    try {
      await queueManager.shutdown();
      console.log('Queue state saved after uncaught exception');
      
      if (mediaCache.shutdown) {
        await mediaCache.shutdown();
        console.log('Media cache shutdown after uncaught exception');
      }
      
      if (telegramBot && telegramBot.shutdown) {
        await telegramBot.shutdown();
      }
      
      if (discordWebhook && discordWebhook.shutdown) {
        await discordWebhook.shutdown();
      }
    } catch (err) {
      console.error('Failed to shut down properly after exception:', err);
    }
    process.exit(1);
  });
  
} catch (error) {
  console.error('Error starting services:', error);
  process.exit(1);
}