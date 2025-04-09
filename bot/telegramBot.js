const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const config = require('../config');
const queueManager = require('../queue/queueManager');
const scraperManager = require('../utils/scraperManager');

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
          response += `\n${i + 1}. ${queue[i].title} (${queue[i].siteName})`;
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
      
      const nextImage = await queueManager.getNextFromQueue();
      
      if (!nextImage) {
        this.bot.sendMessage(chatId, 'Queue is empty, nothing to post.');
        return;
      }
      
      await this.postImage(nextImage);
      await queueManager.removeFromQueue();
      
      this.bot.sendMessage(chatId, 'Image posted to channel.');
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
      
      await queueManager.ensureQueueFileExists();
      await queueManager.removeFromQueue(0, await queueManager.getQueueLength());
      
      this.bot.sendMessage(chatId, 'Queue cleared.');
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
          
          const imageData = await scraperManager.extractFromUrl(url);
          
          // Check if the scraper returned an error (for temporarily disabled scrapers)
          if (imageData.error) {
            this.bot.sendMessage(
              chatId,
              imageData.error,
              { reply_to_message_id: msg.message_id }
            );
            return;
          }
          
          await queueManager.addToQueue(imageData);
          
          const queueLength = await queueManager.getQueueLength();
          
          this.bot.sendMessage(
            chatId, 
            `Added to queue: ${imageData.title}\nCurrent queue length: ${queueLength}`,
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
    queueManager.startScheduler(this.postImage.bind(this));
  }

  restartScheduler() {
    queueManager.stopScheduler();
    this.startScheduler();
  }

  /**
   * Post an image to the Telegram channel
   * @param {Object} imageData - The image data to post
   * @returns {Promise<boolean>} - Whether posting was successful
   */
  async postImage(imageData) {
    try {
      // Create inline keyboard with link to source
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: 'View Original',
              url: imageData.sourceUrl
            }
          ]
        ]
      };

      // For images that are direct links, we can use sendPhoto
      const response = await this.bot.sendPhoto(
        config.channelId,
        imageData.imageUrl,
        {
          caption: imageData.title,
          reply_markup: inlineKeyboard
        }
      );
      
      return true;
    } catch (error) {
      console.error('Error posting image:', error);
      
      // Attempt to download and reupload if direct linking fails
      try {
        const imageResponse = await axios({
          method: 'GET',
          url: imageData.imageUrl,
          responseType: 'stream'
        });
        
        const response = await this.bot.sendPhoto(
          config.channelId,
          imageResponse.data,
          {
            caption: imageData.title,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'View Original',
                    url: imageData.sourceUrl
                  }
                ]
              ]
            }
          }
        );
        
        return true;
      } catch (secondError) {
        console.error('Error uploading image after download:', secondError);
        return false;
      }
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
      
      return true;
    } catch (error) {
      console.error('Error shutting down bot:', error);
      return false;
    }
  }
}

module.exports = StagehandBot;