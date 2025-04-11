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
    this.registerCallbacks();
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
/queue - Show current queue status with interactive management
/send - Post the next image in the queue
/schedule [cron] - Set posting schedule (cron syntax)
/setcount [number] - Set number of images per scheduled post (default: 1)
/clear - Clear the queue
/cleancache - Clean expired items from media cache

Send any link to a supported site to add it to the queue.
Supported sites: e621, FurAffinity, SoFurry, Weasyl, Bluesky
      `;
      this.bot.sendMessage(chatId, helpText);
    });

    // Command to show queue status with visual management
    this.bot.onText(/\/queue(?:\s+(\d+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      // Get page number from the command (defaults to 1)
      const page = parseInt(match[1]) || 1;
      const pageSize = 5;
      
      await this.displayQueuePage(chatId, page, pageSize);
    });

    // Command to post the next image
    this.bot.onText(/\/send/, async (msg) => {
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

  /**
   * Register callback query handlers for interactive buttons
   */
  registerCallbacks() {
    this.bot.on('callback_query', async (query) => {
      try {
        const chatId = query.message.chat.id;
        if (!this.isAuthorized(query.from.id)) {
          await this.bot.answerCallbackQuery(query.id, { text: 'You are not authorized to use these controls.' });
          return;
        }

        const data = query.data.split('_');
        const action = data[0];
        
        switch (action) {
          case 'page': {
            // Handle page navigation
            const page = parseInt(data[1]);
            await this.bot.deleteMessage(chatId, query.message.message_id);
            await this.displayQueuePage(chatId, page, 5);
            await this.bot.answerCallbackQuery(query.id, { text: `Showing page ${page}` });
            break;
          }
          
          case 'remove': {
            // Handle item removal
            const index = parseInt(data[1]);
            const removed = await queueManager.removeFromQueue(index);
            if (removed) {
              const itemType = removed.isVideo ? 'Video' : 'Image';
              await this.bot.answerCallbackQuery(query.id, { text: `Removed ${itemType}: ${removed.title}` });
              
              // Update the queue display
              await this.bot.deleteMessage(chatId, query.message.message_id);
              const page = parseInt(data[2]) || 1;
              await this.displayQueuePage(chatId, page, 5);
            } else {
              await this.bot.answerCallbackQuery(query.id, { text: 'Failed to remove item' });
            }
            break;
          }
          
          case 'top': {
            // Handle move to top (next to post)
            const index = parseInt(data[1]);
            const queue = await queueManager.getQueue();
            
            if (index > 0 && index < queue.length) {
              // Remove the item from its current position
              const item = queue[index];
              queueManager.queueData.queue.splice(index, 1);
              
              // Add it to the beginning
              queueManager.queueData.queue.unshift(item);
              
              // Save changes
              await queueManager.saveQueueToDisk();
              
              await this.bot.answerCallbackQuery(query.id, { text: `Moved "${item.title}" to top of queue` });
              
              // Update the queue display
              await this.bot.deleteMessage(chatId, query.message.message_id);
              const page = parseInt(data[2]) || 1;
              await this.displayQueuePage(chatId, page, 5);
            } else {
              await this.bot.answerCallbackQuery(query.id, { text: 'Failed to move item' });
            }
            break;
          }
          
          case 'preview': {
            // Handle preview item (send a preview of the queued item)
            const index = parseInt(data[1]);
            const queue = await queueManager.getQueue();
            
            if (index >= 0 && index < queue.length) {
              const item = queue[index];
              await this.bot.answerCallbackQuery(query.id, { text: 'Sending preview...' });
              
              // Send a temporary message
              const loadingMsg = await this.bot.sendMessage(chatId, 'Preparing preview...');
              
              try {
                // Generate a preview for the item
                if (item.imageUrl && fs.existsSync(item.imageUrl)) {
                  // Send the image as a preview
                  const caption = `Preview of: ${item.title}\nFrom: ${item.siteName}\nPosition in queue: ${index + 1}`;
                  await this.bot.sendPhoto(chatId, item.imageUrl, { caption });
                } else if (item.imageUrls && Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
                  // Use the first image from multiple images
                  const firstImage = item.imageUrls[0];
                  if (fs.existsSync(firstImage)) {
                    const caption = `Preview of: ${item.title}\nFrom: ${item.siteName}\nPosition in queue: ${index + 1}\n(${item.imageUrls.length} images total)`;
                    await this.bot.sendPhoto(chatId, firstImage, { caption });
                  }
                }
              } catch (error) {
                console.error('Error sending preview:', error);
              } finally {
                // Delete the loading message
                await this.bot.deleteMessage(chatId, loadingMsg.message_id);
              }
            } else {
              await this.bot.answerCallbackQuery(query.id, { text: 'Item not found' });
            }
            break;
          }
        }
      } catch (error) {
        console.error('Error handling callback query:', error);
        await this.bot.answerCallbackQuery(query.id, { text: 'An error occurred' });
      }
    });
  }

  /**
   * Display a page of the queue with interactive buttons
   * @param {number} chatId - Telegram chat ID
   * @param {number} page - Page number to display (1-based)
   * @param {number} pageSize - Number of items per page
   */
  async displayQueuePage(chatId, page, pageSize) {
    const queue = await queueManager.getQueue();
    const queueLength = queue.length;
    
    if (queueLength === 0) {
      this.bot.sendMessage(chatId, 'Queue is empty.');
      return;
    }
    
    // Calculate total pages
    const totalPages = Math.ceil(queueLength / pageSize);
    
    // Ensure page is within bounds
    const currentPage = Math.max(1, Math.min(page, totalPages));
    
    // Calculate start and end indices for this page
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, queueLength);
    
    // Build message with queue items
    let message = `📋 *Queue Management* (${queueLength} items total)\n`;
    message += `Showing items ${startIdx + 1}-${endIdx} of ${queueLength}\n\n`;
    
    // Add each queue item
    for (let i = startIdx; i < endIdx; i++) {
      const item = queue[i];
      const itemType = item.isVideo ? '🎬' : '🖼️';
      const itemIndex = i + 1;
      message += `${itemIndex}. ${itemType} *${item.title}*\n   From: ${item.siteName}\n`;
    }
    
    // Create navigation buttons and item action buttons
    const inline_keyboard = [];
    
    // Item action buttons
    for (let i = startIdx; i < endIdx; i++) {
      const row = [];
      
      // Add "Preview" button
      row.push({
        text: `👁️ #${i+1}`,
        callback_data: `preview_${i}_${currentPage}`
      });
      
      // Add "Remove" button
      row.push({
        text: `❌ #${i+1}`,
        callback_data: `remove_${i}_${currentPage}`
      });
      
      // Only add "Move to top" if not already at top
      if (i > 0) {
        row.push({
          text: `⬆️ #${i+1}`,
          callback_data: `top_${i}_${currentPage}`
        });
      } else {
        row.push({
          text: `🔼 Next`,
          callback_data: `preview_0_${currentPage}`
        });
      }
      
      inline_keyboard.push(row);
    }
    
    // Navigation row for paging
    const navRow = [];
    
    // Previous page button
    if (currentPage > 1) {
      navRow.push({
        text: '◀️ Previous',
        callback_data: `page_${currentPage - 1}`
      });
    }
    
    // Page indicator
    navRow.push({
      text: `Page ${currentPage}/${totalPages}`,
      callback_data: `page_${currentPage}`
    });
    
    // Next page button
    if (currentPage < totalPages) {
      navRow.push({
        text: 'Next ▶️',
        callback_data: `page_${currentPage + 1}`
      });
    }
    
    if (navRow.length > 0) {
      inline_keyboard.push(navRow);
    }
    
    // Send the message with inline keyboard
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard
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

      // Special caption for FurAffinity posts
      let caption = '';
      if (mediaData.siteName === 'FurAffinity' && mediaData.title && mediaData.name) {
        caption = `🖼️: ${mediaData.title}\n🎨: ${mediaData.name}`;
      }

      // Check if we're dealing with multiple images (imageUrls array with more than one item)
      if (mediaData.imageUrls && Array.isArray(mediaData.imageUrls) && mediaData.imageUrls.length > 1) {
        console.log(`Posting multiple images: ${mediaData.imageUrls.length} images`);
        
        // Since media groups don't support inline buttons, we'll include the link in the caption
        const groupCaption = caption ? 
          `${caption}\n\nOriginal: ${mediaData.sourceUrl}` : 
          `${mediaData.title}\n\nOriginal: ${mediaData.sourceUrl}`;
        
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
              ...(i === 0 ? { caption: groupCaption } : {})
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
              caption: caption, // Add the caption here
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
                caption: caption, // Add the caption here
                reply_markup: inlineKeyboard
              }
            );
            return true;
          } catch (videoError) {
            console.error('Error posting video directly:', videoError);
            
            // Fallback to sending image/thumbnail if video fails
            if (mediaData.imageUrl && mediaData.imageUrl !== mediaData.videoUrl) {
              const fallbackCaption = caption ? 
                `${caption}\n(Video post - see original)` : 
                "(Video post - see original)";
              
              const response = await this.bot.sendPhoto(
                config.channelId,
                mediaData.imageUrl,
                {
                  caption: fallbackCaption,
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
            caption: caption, // Add the caption here
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
              caption: caption, // Add the caption here
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
                caption: caption, // Add the caption here
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