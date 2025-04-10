const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const config = require('../config');
const queueManager = require('../queue/queueManager');
const scraperManager = require('../utils/scraperManager');
const mediaCache = require('../utils/mediaCache');

class StagehandBot {
  constructor() {
    this.bot = new TelegramBot(config.botToken, { polling: true });
    this.init();
  }

  init() {
    this.registerCommands();
    this.startScheduler();
    console.log('Stagehand bot started...');
  }

  registerCommands() {
    // Command to start the bot
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, 'Stagehand bot is active. Send me links to queue images for posting!');
    });

    // Command to show help
    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      const helpText = `
Stagehand Bot Commands:
/queue - Show current queue status
/test - Post the next image in the queue
/schedule [cron] - Set posting schedule (cron syntax)
/setcount [number] - Set number of images per scheduled post (default: 1)
/clear - Clear the queue
/cleancache - Clean expired items from media cache

Send any link to a supported site to add it to the queue.
Supported sites: e621, FurAffinity, SoFurry, Weasyl, Bluesky
      `;
      this.bot.sendMessage(chatId, helpText);
    });

    // Command to show queue status
    this.bot.onText(/\/queue/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      const queueLength = await queueManager.getQueueLength();
      const queue = await queueManager.getQueue();
      let response = `Current queue has ${queueLength} items.`;
      
      if (queueLength > 0) {
        response += '\n\nNext 5 items:';
        for (let i = 0; i < Math.min(5, queueLength); i++) {
          const itemType = queue[i].isVideo ? '🎬 Video' : '🖼️ Image';
          response += `\n${i + 1}. ${itemType}: ${queue[i].title} (${queue[i].siteName})`;
        }
      }
      
      this.bot.sendMessage(chatId, response);
    });

    // Command to test post the next image
    this.bot.onText(/\/test/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      const nextItem = await queueManager.getNextFromQueue();
      
      if (!nextItem) {
        this.bot.sendMessage(chatId, 'Queue is empty, nothing to post.');
        return;
      }
      
      await this.postMedia(nextItem);
      await queueManager.removeFromQueue();
      
      const itemType = nextItem.isVideo ? 'Video' : 'Image';
      this.bot.sendMessage(chatId, `${itemType} posted to channel.`);
    });

    // Command to clean cache
    this.bot.onText(/\/cleancache/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      this.bot.sendMessage(chatId, 'Cleaning media cache...');
      
      try {
        await mediaCache.cleanupCache();
        this.bot.sendMessage(chatId, 'Media cache cleaned successfully.');
      } catch (error) {
        this.bot.sendMessage(chatId, `Error cleaning cache: ${error.message}`);
      }
    });

    // Command to set posting schedule
    this.bot.onText(/\/schedule\s*(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      const cronExpression = match[1].trim();
      
      if (!cronExpression) {
        this.bot.sendMessage(chatId, `Current schedule: ${queueManager.cronSchedule}`);
        return;
      }
      
      const success = queueManager.setCronSchedule(cronExpression);
      
      if (success) {
        this.restartScheduler();
        this.bot.sendMessage(chatId, `Schedule updated to: ${cronExpression}`);
      } else {
        this.bot.sendMessage(chatId, 'Invalid cron expression. Please use valid cron syntax.');
      }
    });

    // Command to set number of images per scheduled post
    this.bot.onText(/\/setcount\s*(.*)/, (msg, match) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      const count = parseInt(match[1].trim());
      
      if (isNaN(count) || count < 1) {
        this.bot.sendMessage(chatId, `Current images per interval: ${queueManager.imagesPerInterval}`);
        return;
      }
      
      const success = queueManager.setImagesPerInterval(count);
      
      if (success) {
        this.bot.sendMessage(chatId, `Images per interval updated to: ${count}`);
      } else {
        this.bot.sendMessage(chatId, 'Invalid count. Please use a positive integer.');
      }
    });

    // Command to clear the queue
    this.bot.onText(/\/clear/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      const queueLength = await queueManager.getQueueLength();
      
      if (queueLength === 0) {
        this.bot.sendMessage(chatId, 'Queue is already empty.');
        return;
      }
      
      // Clear the queue by removing all items
      for (let i = 0; i < queueLength; i++) {
        await queueManager.removeFromQueue(0);
      }
      
      this.bot.sendMessage(chatId, `Queue cleared (${queueLength} items removed).`);
    });

    // Handle URL links
    this.bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('http')) {
        const chatId = msg.chat.id;
        
        if (!this.isAuthorized(msg.from.id)) {
          this.bot.sendMessage(chatId, 'You are not authorized to use this bot.');
          return;
        }
        
        try {
          const url = msg.text.trim();
          
          this.bot.sendMessage(chatId, 'Processing link...', { reply_to_message_id: msg.message_id });
          
          const mediaData = await scraperManager.extractFromUrl(url);
          
          // Check if the scraper returned an error (for temporarily disabled scrapers)
          if (mediaData.error) {
            this.bot.sendMessage(
              chatId,
              mediaData.error,
              { reply_to_message_id: msg.message_id }
            );
            return;
          }
          
          await queueManager.addToQueue(mediaData);
          
          const queueLength = await queueManager.getQueueLength();
          const mediaType = mediaData.isVideo ? 'Video' : 'Image';
          
          this.bot.sendMessage(
            chatId, 
            `Added to queue: ${mediaType} - ${mediaData.title}\nCurrent queue length: ${queueLength}`,
            { reply_to_message_id: msg.message_id }
          );
        } catch (error) {
          this.bot.sendMessage(
            chatId, 
            `Error processing link: ${error.message}`,
            { reply_to_message_id: msg.message_id }
          );
        }
      }
    });
  }

  isAuthorized(userId) {
    // If no authorized users are specified, anyone can use the bot
    if (config.authorizedUsers.length === 0) {
      return true;
    }
    
    return config.authorizedUsers.includes(userId.toString());
  }

  startScheduler() {
    queueManager.startScheduler(this.postMedia.bind(this));
  }

  restartScheduler() {
    queueManager.stopScheduler();
    this.startScheduler();
  }

  /**
   * Post media (image or video) to the Telegram channel
   * @param {Object} mediaData - The media data to post
   * @returns {Promise<boolean>} - Whether posting was successful
   */
  async postMedia(mediaData) {
    try {
      // Create inline keyboard with link to source
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: 'View Original',
              url: mediaData.sourceUrl
            }
          ]
        ]
      };

      // Check if we're dealing with multiple images (imageUrls array with more than one item)
      if (mediaData.imageUrls && Array.isArray(mediaData.imageUrls) && mediaData.imageUrls.length > 1) {
        console.log(`Posting multiple images: ${mediaData.imageUrls.length} images`);
        
        // Since media groups don't support inline buttons, we'll include the link in the caption
        const caption = `${mediaData.title}\n\nOriginal: ${mediaData.sourceUrl}`;
        
        // Prepare media group format for Telegram
        const mediaGroup = [];
        
        // Process each image in the array
        for (let i = 0; i < mediaData.imageUrls.length; i++) {
          const imagePath = mediaData.imageUrls[i];
          
          if (fs.existsSync(imagePath)) {
            // Add as InputMediaPhoto for the media group - use correct format
            mediaGroup.push({
              type: 'photo',
              media: fs.createReadStream(imagePath),
              // Only add caption to the first image
              ...(i === 0 ? { caption } : {})
            });
          } else {
            console.warn(`Image file not found: ${imagePath}`);
          }
        }
        
        if (mediaGroup.length > 0) {
          try {
            console.log(`Sending media group with ${mediaGroup.length} images`);
            // Send as a media group (album)
            await this.bot.sendMediaGroup(config.channelId, mediaGroup);
            return true;
          } catch (mediaGroupError) {
            console.error('Error posting media group:', mediaGroupError);
            // If posting as a group fails, fall back to posting the first image
            console.log('Falling back to posting single image');
          }
        }
      }

      // Check if we're dealing with a video
      if (mediaData.isVideo && mediaData.videoUrl) {
        console.log(`Posting video: ${mediaData.videoUrl}`);
        
        // For videos from local cache, we need to use the file path
        if (fs.existsSync(mediaData.videoUrl)) {
          const response = await this.bot.sendVideo(
            config.channelId,
            mediaData.videoUrl,
            {
              // Removed the caption
              reply_markup: inlineKeyboard
            }
          );
          return true;
        } else {
          // Try to post from URL if not in cache
          try {
            const response = await this.bot.sendVideo(
              config.channelId,
              mediaData.videoUrl,
              {
                // Removed the caption
                reply_markup: inlineKeyboard
              }
            );
            return true;
          } catch (videoError) {
            console.error('Error posting video directly:', videoError);
            
            // Fallback to sending image/thumbnail if video fails
            if (mediaData.imageUrl && mediaData.imageUrl !== mediaData.videoUrl) {
              const response = await this.bot.sendPhoto(
                config.channelId,
                mediaData.imageUrl,
                {
                  // Removed the caption, only indicating this is a video post
                  caption: "(Video post - see original)",
                  reply_markup: inlineKeyboard
                }
              );
              return true;
            }
            
            throw videoError;
          }
        }
      } 
      
      // Handle image posting (including video thumbnails as fallback)
      console.log(`Posting image: ${mediaData.imageUrl}`);
      
      // For images from local cache, we need to use the file path
      if (fs.existsSync(mediaData.imageUrl)) {
        const response = await this.bot.sendPhoto(
          config.channelId,
          mediaData.imageUrl,
          {
            // Removed the caption
            reply_markup: inlineKeyboard
          }
        );
        return true;
      } else {
        // Try to post from URL if not in cache
        try {
          const response = await this.bot.sendPhoto(
            config.channelId,
            mediaData.imageUrl,
            {
              // Removed the caption
              reply_markup: inlineKeyboard
            }
          );
          return true;
        } catch (imageError) {
          console.error('Error posting image:', imageError);
          
          // Attempt to download and reupload if direct linking fails
          try {
            const imageResponse = await axios({
              method: 'GET',
              url: mediaData.imageUrl,
              responseType: 'stream'
            });
            
            const response = await this.bot.sendPhoto(
              config.channelId,
              imageResponse.data,
              {
                // Removed the caption
                reply_markup: inlineKeyboard
              }
            );
            
            return true;
          } catch (secondError) {
            console.error('Error uploading image after download:', secondError);
            return false;
          }
        }
      }
    } catch (error) {
      console.error('Error posting media:', error);
      return false;
    }
  }

  /**
   * Shutdown the bot gracefully
   * @returns {Promise<void>}
   */
  async shutdown() {
    try {
      console.log('Stopping Telegram bot polling...');
      await this.bot.stopPolling();
      console.log('Telegram bot polling stopped');
      
      // Stop the scheduler if it's running
      queueManager.stopScheduler();
      
      // Shut down media cache if needed
      if (mediaCache.shutdown) {
        await mediaCache.shutdown();
      }
      
      return true;
    } catch (error) {
      console.error('Error shutting down bot:', error);
      return false;
    }
  }
}

module.exports = StagehandBot;