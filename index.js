require('dotenv').config();
const StagehandBot = require('./bot/telegramBot');
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

let bot;

// Initialize the bot
try {
  // Initialize media cache first
  console.log('Initializing media cache...');
  
  // Initialize the bot
  bot = new StagehandBot();
  console.log('Stagehand bot started successfully');
  console.log(`Posting to channel: ${process.env.CHANNEL_ID}`);
  
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
      
      // Additional bot cleanup if needed
      if (bot.shutdown) {
        await bot.shutdown();
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
    } catch (err) {
      console.error('Failed to shut down properly after exception:', err);
    }
    process.exit(1);
  });
  
} catch (error) {
  console.error('Error starting bot:', error);
  process.exit(1);
}