const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../config');
const queueManager = require('../queue/queueManager');
const scraperManager = require('../utils/scraperManager');
const mediaCache = require('../utils/mediaCache');
const AnnouncementManager = require('../utils/announcementManager');
const discordWebhook = require('./discordWebhook');

class StagehandBot {
  constructor() {
    this.bot = new TelegramBot(config.botToken, { polling: true });
    this.serviceName = 'telegram';
    this.channelId = config.channelId;
    this.announcements = new AnnouncementManager(this);
    this.init();
  }

  async init() {
    await this.announcements.init();
    this.registerCommands();
    this.registerCallbacks();
    console.log('Telegram bot started...');
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
/schedule [cron] - Set posting schedule (cron syntax, use https://crontab.guru/ for help)
/setcount [number] - Set number of images per scheduled post (default: 1)
/clear - Clear the queue
/cleancache - Clean expired items from media cache
/announce - Create a new announcement
/announcements - Manage existing announcements
/update - Update bot from GitHub repository (owner only)

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
      
      // Status tracking variables
      let telegramSuccess = false;
      let discordSuccess = false;
      let telegramStatus = 'not attempted';
      let discordStatus = 'not attempted';
      
      // Post to Telegram if it hasn't been posted yet
      if (!queueManager.hasBeenPostedByService(0, 'telegram')) {
        telegramStatus = 'attempting';
        const telegramResult = await this.postMedia(nextItem);
        
        if (telegramResult) {
          await queueManager.markPostedByService(0, 'telegram');
          telegramSuccess = true;
          telegramStatus = 'posted';
        } else {
          telegramStatus = 'failed';
        }
      } else {
        telegramStatus = 'already posted';
        telegramSuccess = true;
      }
      
      // Post to Discord if it's configured and hasn't been posted yet
      if (discordWebhook.isEnabled() && !queueManager.hasBeenPostedByService(0, 'discord')) {
        discordStatus = 'attempting';
        try {
          const discordResult = await discordWebhook.postMedia(nextItem);
          
          if (discordResult) {
            await queueManager.markPostedByService(0, 'discord');
            discordSuccess = true;
            discordStatus = 'posted';
          } else {
            discordStatus = 'failed';
          }
        } catch (error) {
          console.error('Error posting to Discord:', error);
          discordStatus = 'error: ' + error.message;
        }
      } else if (discordWebhook.isEnabled()) {
        discordStatus = 'already posted';
        discordSuccess = true;
      } else {
        discordStatus = 'disabled';
      }
      
      // Construct detailed response message
      const itemType = nextItem.isVideo ? 'Video' : 'Image';
      let responseMessage = `${itemType}: "${nextItem.title}"\n\n`;
      responseMessage += `Telegram: ${telegramStatus}\n`;
      
      if (discordWebhook.isEnabled()) {
        responseMessage += `Discord: ${discordStatus}\n`;
      }
      
      // If at least one service was successful, consider it a partial success
      if (telegramSuccess || discordSuccess) {
        this.bot.sendMessage(chatId, responseMessage);
      } else {
        this.bot.sendMessage(chatId, `Failed to post ${itemType} to any service.\n${responseMessage}`);
      }
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

    // Command to manually trigger an update from GitHub
    this.bot.onText(/\/update/, async (msg) => {
      const chatId = msg.chat.id;
      
      // Only the bot owner can run updates
      if (!this.isOwner(msg.from.id)) {
        this.bot.sendMessage(chatId, 'Only the bot owner can trigger updates.');
        return;
      }
      
      this.bot.sendMessage(chatId, 'Checking for updates...');
      
      try {
        const updater = require('../utils/updater');
        const isUpdateAvailable = await updater.isUpdateAvailable();
        
        if (!isUpdateAvailable) {
          this.bot.sendMessage(chatId, 'No updates available. Bot is already running the latest version.');
          return;
        }
        
        const statusMessage = await this.bot.sendMessage(chatId, 'Updates found! Downloading and applying updates...');
        
        const updateResult = await updater.manualUpdate();
        
        if (updateResult) {
          await this.bot.editMessageText('Update successful! Bot will restart to apply changes.', {
            chat_id: chatId,
            message_id: statusMessage.message_id
          });
          
          // Give a moment for the message to be delivered before restarting
          setTimeout(async () => {
            try {
              // Restart the bot using PM2
              await execAsync('pm2 restart --update-env stagehand');
            } catch (restartError) {
              console.error('Error restarting bot:', restartError);
              this.bot.sendMessage(chatId, `Error during restart: ${restartError.message}`);
            }
          }, 2000);
        } else {
          this.bot.sendMessage(chatId, 'Update process completed, but no changes were applied.');
        }
      } catch (error) {
        console.error('Error during manual update:', error);
        this.bot.sendMessage(chatId, `Error during update: ${error.message}`);
      }
    });

    // Command to add a text announcement
    this.bot.onText(/^\/announce(?!\S)/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      // Initialize the interactive announcement creation process
      this.pendingAnnouncements = this.pendingAnnouncements || {};
      this.pendingAnnouncements[msg.from.id] = {};
      
      // Display introduction message with formatting options
      this.bot.sendMessage(
        chatId,
        '📣 *Create New Announcement*\n\n' +
        'I\'ll guide you through creating an announcement step by step:\n' +
        '1️⃣ Name your announcement\n' +
        '2️⃣ Write the message content\n' +
        '3️⃣ Set a schedule\n' +
        '4️⃣ Add an optional button (if desired)\n\n' +
        'You can use these formatting options in your message:\n' +
        '- *text* for italic\n' +
        '- **text** for bold\n' +
        '- __text__ for underlined\n' +
        '- ~~text~~ for strikethrough\n\n' +
        'Let\'s start! First, what would you like to name this announcement?',
        { 
          parse_mode: 'Markdown',
          reply_markup: { force_reply: true } 
        }
      ).then(namePrompt => {
        // Set up a one-time listener for the name response
        this.bot.onReplyToMessage(chatId, namePrompt.message_id, async (nameMsg) => {
          const announcementName = nameMsg.text === 'skip' ? '' : nameMsg.text;
          this.pendingAnnouncements[msg.from.id].name = announcementName;
          
          // Now ask for the announcement message text
          this.bot.sendMessage(
            chatId,
            'Great! Now enter the announcement message content.\n\n' +
            'Your message can contain multiple lines and formatting:\n' +
            '- *text* for italic\n' +
            '- **text** for bold\n' +
            '- __text__ for underlined\n' +
            '- ~~text~~ for strikethrough\n\n' +
            'Type your message now:',
            { 
              parse_mode: 'Markdown',
              reply_markup: { force_reply: true } 
            }
          ).then(messagePrompt => {
            // Set up a one-time listener for the message text response
            this.bot.onReplyToMessage(chatId, messagePrompt.message_id, async (messageTextMsg) => {
              this.pendingAnnouncements[msg.from.id].message = messageTextMsg.text;
          
              try {
                // Show a preview of the formatted message
                const previewText = this.announcements.formatMessageText(this.pendingAnnouncements[msg.from.id].message);
                
                // Send a preview message to show how it will look
                await this.bot.sendMessage(
                  chatId,
                  "Here's a preview of your announcement with formatting:",
                  { parse_mode: 'Markdown' }
                );
                
                // Send the actual preview
                await this.bot.sendMessage(
                  chatId,
                  previewText,
                  { parse_mode: 'HTML' }
                );
              } catch (error) {
                console.error("Error showing announcement preview:", error);
                await this.bot.sendMessage(
                  chatId,
                  "Note: There might be issues with your formatting. Please ensure all formatting tags are properly closed."
                );
              }
               // Now ask for a schedule
              this.bot.sendMessage(
                chatId,
                'Now, let\'s set the schedule for this announcement.\n\n' +
                'Enter a cron schedule expression. Examples:\n' +
                '- `0 9 * * *` = Every day at 9:00 AM\n' +
                '- `0 18 * * 5` = Every Friday at 6:00 PM\n' +
                '- `0 12 1 * *` = First day of each month at noon\n\n' +
                'For more options, visit https://crontab.guru/',
                { 
                  parse_mode: 'Markdown',
                  reply_markup: { force_reply: true } 
                }
              ).then(schedulePrompt => {
                // Set up a one-time listener for the schedule response
                this.bot.onReplyToMessage(chatId, schedulePrompt.message_id, async (scheduleMsg) => {
                  const cronSchedule = scheduleMsg.text;
                  
                  // Validate the cron schedule
                  if (!this.announcements.isValidCronExpression(cronSchedule)) {
                    this.bot.sendMessage(
                      chatId,
                      '⚠️ That doesn\'t appear to be a valid cron schedule. Please try again using the format shown in the examples.',
                      { parse_mode: 'Markdown' }
                    ).then(() => {
                      // Ask again for a valid schedule
                      this.bot.sendMessage(
                        chatId,
                        'Please enter a valid cron schedule. Examples:\n' +
                        '- `0 9 * * *` = Every day at 9:00 AM\n' +
                        '- `0 18 * * 5` = Every Friday at 6:00 PM\n' +
                        '- `0 12 1 * *` = First day of each month at noon',
                        { 
                          parse_mode: 'Markdown',
                          reply_markup: { force_reply: true } 
                        }
                      ).then((newSchedulePrompt) => {
                        // Handle the new schedule response
                        this.bot.onReplyToMessage(chatId, newSchedulePrompt.message_id, (newScheduleMsg) => {
                          // Replace the schedule with the new one
                          const validCronSchedule = newScheduleMsg.text;
                          
                          if (!this.announcements.isValidCronExpression(validCronSchedule)) {
                            this.bot.sendMessage(
                              chatId,
                              '⚠️ Still not a valid cron schedule. Using "0 12 * * *" (daily at noon) as a default. You can edit this later.'
                            );
                            this.pendingAnnouncements[msg.from.id].cronSchedule = "0 12 * * *";
                            
                            // Continue to button step
                            this.askAboutButton(chatId, msg.from.id);
                          } else {
                            this.pendingAnnouncements[msg.from.id].cronSchedule = validCronSchedule;
                            
                            // Continue to button step
                            this.askAboutButton(chatId, msg.from.id);
                          }
                        });
                      });
                    });
                    return;
                  }
                  
                  // Store the schedule
                  this.pendingAnnouncements[msg.from.id].cronSchedule = cronSchedule;
                  
                  // Ask if they want to add a button
                  this.bot.sendMessage(
                    chatId,
                    'Would you like to add a button with a link to this announcement?',
                    {
                      reply_markup: {
                        inline_keyboard: [
                          [
                            { text: 'Yes', callback_data: 'add_button' },
                            { text: 'No', callback_data: 'skip_button' }
                          ]
                        ]
                      }
                    }
                  ).then(buttonPrompt => {
                    // Callback handler for yes/no button selection
                    this.bot.once('callback_query', async (query) => {
                      await this.bot.answerCallbackQuery(query.id);
                      
                      // Delete the yes/no prompt
                      await this.bot.deleteMessage(chatId, buttonPrompt.message_id);
                      
                      if (query.data === 'add_button') {
                        // User wants to add a button
                        this.bot.sendMessage(
                          chatId,
                          'Please enter the button text:',
                          { reply_markup: { force_reply: true } }
                        ).then(buttonTextPrompt => {
                          this.bot.onReplyToMessage(chatId, buttonTextPrompt.message_id, async (buttonTextMsg) => {
                            const buttonText = buttonTextMsg.text;
                            
                            // Now ask for the button URL
                            this.bot.sendMessage(
                              chatId,
                              'Please enter the button URL:',
                              { reply_markup: { force_reply: true } }
                            ).then(buttonUrlPrompt => {
                              this.bot.onReplyToMessage(chatId, buttonUrlPrompt.message_id, async (buttonUrlMsg) => {
                                const buttonUrl = buttonUrlMsg.text;
                                
                                // Store the button object
                                const button = {
                                  text: buttonText,
                                  url: buttonUrl
                                };
                                
                                // Show confirmation with preview
                                await this.showAnnouncementConfirmation(
                                  chatId, 
                                  msg.from.id, 
                                  this.pendingAnnouncements[msg.from.id].name,
                                  this.pendingAnnouncements[msg.from.id].message,
                                  this.pendingAnnouncements[msg.from.id].cronSchedule,
                                  button
                                );
                              });
                            });
                          });
                        });
                      } else {
                        // User doesn't want to add a button
                        // Show confirmation with preview
                        await this.showAnnouncementConfirmation(
                          chatId, 
                          msg.from.id, 
                          this.pendingAnnouncements[msg.from.id].name,
                          this.pendingAnnouncements[msg.from.id].message,
                          this.pendingAnnouncements[msg.from.id].cronSchedule
                        );
                      }
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
    
    // Command to list and manage all announcements
    this.bot.onText(/^\/announcements(?!\S)/, async (msg) => {
      const chatId = msg.chat.id;
      
      if (!this.isAuthorized(msg.from.id)) {
        this.bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
      }
      
      const announcements = this.announcements.getAnnouncements();
      
      if (announcements.length === 0) {
        this.bot.sendMessage(
          chatId,
          'No announcements configured. Use /announce to create a new announcement.'
        );
        return;
      }
      
      // Format the list of announcements with inline buttons
      let message = '📣 *Text Announcements*\n\n';
      
      const inlineKeyboard = [];
      
      for (let i = 0; i < announcements.length; i++) {
        const announcement = announcements[i];
        
        // Add announcement details to message
        message += `*${i+1}. ${announcement.name}*\n`;
        message += `Schedule: \`${announcement.cronSchedule}\`\n`;
        message += `Last run: ${announcement.lastRun ? new Date(announcement.lastRun).toLocaleString() : 'Never'}\n`;
        
        // Show button info if present
        if (announcement.button && announcement.button.text && announcement.button.url) {
          message += `Button: "${announcement.button.text}" → ${announcement.button.url}\n`;
        }
        
        // Format the message preview, replacing line breaks with special character
        const previewMessage = announcement.message
          .replace(/\n/g, '↵')  // Replace line breaks with a visible symbol
          .substring(0, 50);
        message += `Message: "${previewMessage}${announcement.message.length > 50 ? '...' : ''}"\n\n`;
        
        // Add buttons for this announcement
        inlineKeyboard.push([
          {
            text: `▶️ Run #${i+1}`,
            callback_data: `run_announcement_${announcement.id}`
          },
          {
            text: `✏️ Edit #${i+1}`,
            callback_data: `edit_announcement_${announcement.id}`
          },
          {
            text: `❌ Delete #${i+1}`,
            callback_data: `delete_announcement_${announcement.id}`
          }
        ]);
      }
      
      // Add a button to create a new announcement
      inlineKeyboard.push([
        {
          text: '➕ Add New Announcement',
          callback_data: 'new_announcement'
        }
      ]);
      
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
    });

    // Handle URL links
    this.bot.on('message', async (msg) => {
      if (msg.text && msg.text.startsWith('http')) {
        const chatId = msg.chat.id;
        
        // Skip processing if this is part of an announcement setup
        const isInAnnouncementFlow = this.pendingAnnouncements && this.pendingAnnouncements[msg.from.id];
        const isInButtonEditFlow = this.editingAnnouncementButton && this.editingAnnouncementButton[msg.from.id];
        
        if (isInAnnouncementFlow || isInButtonEditFlow) {
          // This URL is part of an announcement setup, so we should not process it as a link
          return;
        }
        
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

          // New announcement management callback handlers
          case 'run': {
            if (data[1] === 'announcement') {
              const announcementId = data[2];
              await this.bot.answerCallbackQuery(query.id, { text: 'Sending announcement...' });
              
              try {
                const result = await this.announcements.sendAnnouncementNow(announcementId);
                if (result) {
                  await this.bot.sendMessage(chatId, `✅ Announcement sent successfully!`);
                } else {
                  await this.bot.sendMessage(chatId, `❌ Failed to send announcement.`);
                }
              } catch (error) {
                await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
              }
              
              // Refresh announcements list
              await this.bot.deleteMessage(chatId, query.message.message_id);
              await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
            }
            break;
          }
          
          case 'delete': {
            if (data[1] === 'announcement') {
              const announcementId = data[2];
              
              // Get the announcement to show its name
              const announcement = this.announcements.getAnnouncementById(announcementId);
              if (!announcement) {
                await this.bot.answerCallbackQuery(query.id, { text: 'Announcement not found.' });
                return;
              }
              
              // Show confirmation dialog
              await this.bot.answerCallbackQuery(query.id);
              
              const confirmMessage = await this.bot.sendMessage(
                chatId,
                `Are you sure you want to delete the announcement "${announcement.name}"?`,
                {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '✅ Yes, delete it', callback_data: `confirm_delete_announcement_${announcementId}` },
                        { text: '❌ No, cancel', callback_data: 'cancel_delete_announcement' }
                      ]
                    ]
                  }
                }
              );
            }
            break;
          }
          
          case 'confirm': {
            if (data[1] === 'delete' && data[2] === 'announcement') {
              const announcementId = data[3];
              
              try {
                const result = await this.announcements.removeAnnouncement(announcementId);
                if (result) {
                  await this.bot.answerCallbackQuery(query.id, { text: 'Announcement deleted successfully.' });
                } else {
                  await this.bot.answerCallbackQuery(query.id, { text: 'Failed to delete announcement.' });
                }
                
                // Delete confirmation message
                await this.bot.deleteMessage(chatId, query.message.message_id);
                
                // Refresh announcements list
                await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
              } catch (error) {
                await this.bot.answerCallbackQuery(query.id, { text: `Error: ${error.message}` });
              }
            }
            break;
          }
          
          case 'cancel': {
            if (data[1] === 'delete' && data[2] === 'announcement') {
              await this.bot.answerCallbackQuery(query.id, { text: 'Delete cancelled.' });
              await this.bot.deleteMessage(chatId, query.message.message_id);
            }
            break;
          }
          
          case 'edit': {
            if (data[1] === 'announcement') {
              const announcementId = data[2];
              const announcement = this.announcements.getAnnouncementById(announcementId);
              
              if (!announcement) {
                await this.bot.answerCallbackQuery(query.id, { text: 'Announcement not found.' });
                return;
              }
              
              await this.bot.answerCallbackQuery(query.id);
              
              // Show edit options
              const editMessage = await this.bot.sendMessage(
                chatId,
                `Editing announcement: *${announcement.name}*\n\nWhat would you like to edit?`,
                {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { 
                          text: '📝 Edit Message', 
                          callback_data: `edit_announcement_message_${announcementId}` 
                        }
                      ],
                      [
                        { 
                          text: '⏰ Edit Schedule', 
                          callback_data: `edit_announcement_schedule_${announcementId}` 
                        }
                      ],
                      [
                        { 
                          text: '🏷️ Edit Name', 
                          callback_data: `edit_announcement_name_${announcementId}` 
                        }
                      ],
                      [
                        { 
                          text: '🔗 Edit Button', 
                          callback_data: `edit_announcement_button_${announcementId}` 
                        }
                      ],
                      [
                        { 
                          text: '❌ Cancel', 
                          callback_data: 'cancel_edit_announcement' 
                        }
                      ]
                    ]
                  }
                }
              );
            } else if (data[1] === 'announcement' && (data[2] === 'message' || data[2] === 'name' || data[2] === 'schedule' || data[2] === 'button')) {
              const field = data[2];
              const announcementId = data[3];
              const announcement = this.announcements.getAnnouncementById(announcementId);
              
              if (!announcement) {
                await this.bot.answerCallbackQuery(query.id, { text: 'Announcement not found.' });
                return;
              }
              
              await this.bot.answerCallbackQuery(query.id);
              
              // Delete the edit options message
              await this.bot.deleteMessage(chatId, query.message.message_id);
              
              let promptText = '';
              switch (field) {
                case 'message':
                  promptText = `Please enter the new message text for the announcement "${announcement.name}":\n\nCurrent message:\n${announcement.message}\n\nYou can use line breaks and formatting in your announcement.`;
                  break;
                case 'name':
                  promptText = `Please enter the new name for the announcement "${announcement.name}":`;
                  break;
                case 'schedule':
                  promptText = `Please enter the new cron schedule for the announcement "${announcement.name}" (use https://crontab.guru/ for help):\n\nCurrent schedule: ${announcement.cronSchedule}`;
                  break;
                case 'button':
                  // For button editing, we'll first ask if they want to add, edit, or remove a button
                  const hasButton = announcement.button && announcement.button.text && announcement.button.url;
                  
                  if (hasButton) {
                    // Show options to edit or remove existing button
                    await this.bot.sendMessage(
                      chatId,
                      `Current button: "${announcement.button.text}" → ${announcement.button.url}\n\nWhat would you like to do?`,
                      {
                        reply_markup: {
                          inline_keyboard: [
                            [
                              { 
                                text: '✏️ Edit Button', 
                                callback_data: `edit_announcement_button_edit_${announcementId}` 
                              }
                            ],
                            [
                              { 
                                text: '❌ Remove Button', 
                                callback_data: `edit_announcement_button_remove_${announcementId}` 
                              }
                            ],
                            [
                              { 
                                text: '↩️ Cancel', 
                                callback_data: 'cancel_edit_announcement_button' 
                              }
                            ]
                          ]
                        }
                      }
                    );
                    return;
                  } else {
                    // No existing button, ask if they want to add one
                    await this.bot.sendMessage(
                      chatId,
                      `This announcement doesn't have a button. Would you like to add one?`,
                      {
                        reply_markup: {
                          inline_keyboard: [
                            [
                              { 
                                text: '➕ Add Button', 
                                callback_data: `edit_announcement_button_add_${announcementId}` 
                              }
                            ],
                            [
                              { 
                                text: '↩️ Cancel', 
                                callback_data: 'cancel_edit_announcement_button' 
                              }
                            ]
                          ]
                        }
                      }
                    );
                    return;
                  }
              }

              // For message, name, and schedule we'll send a prompt and handle the reply
              if (field === 'message' || field === 'name' || field === 'schedule') {
                // Send the prompt with force_reply
                const promptMsg = await this.bot.sendMessage(
                  chatId, 
                  promptText,
                  { reply_markup: { force_reply: true } }
                );
                
                // Set up one-time handler for the response
                this.bot.onReplyToMessage(chatId, promptMsg.message_id, async (responseMsg) => {
                  try {
                    // Get the response text - preserve line breaks and formatting exactly as received
                    const responseText = responseMsg.text;
                    
                    // Prepare the update object
                    const updates = {};
                    updates[field] = responseText; // Raw text will preserve line breaks
                    
                    // Update the announcement
                    await this.announcements.updateAnnouncement(announcementId, updates);
                    
                    // Notify user of success
                    let successMsg = `✅ Announcement ${field} updated successfully!`;
                    if (field === 'message') {
                      successMsg += '\n\nYour message with all line breaks and formatting has been saved.';
                    }
                    await this.bot.sendMessage(chatId, successMsg);
                    
                    // Refresh the announcements list
                    await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
                  } catch (error) {
                    await this.bot.sendMessage(
                      chatId,
                      `❌ Error updating announcement: ${error.message}`
                    );
                  }
                });
                
                // Skip the rest of the code for button
                return;
              }
              
              // For button editing, we'll first ask if they want to add, edit, or remove a button
              const hasButton = announcement.button && announcement.button.text && announcement.button.url;
              
              if (hasButton) {
                // Show options to edit or remove existing button
                await this.bot.sendMessage(
                  chatId,
                  `Current button: "${announcement.button.text}" → ${announcement.button.url}\n\nWhat would you like to do?`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          { 
                            text: '✏️ Edit Button', 
                            callback_data: `edit_announcement_button_edit_${announcementId}` 
                          }
                        ],
                        [
                          { 
                            text: '❌ Remove Button', 
                            callback_data: `edit_announcement_button_remove_${announcementId}` 
                          }
                        ],
                        [
                          { 
                            text: '↩️ Cancel', 
                            callback_data: 'cancel_edit_announcement_button' 
                          }
                        ]
                      ]
                    }
                  }
                );
                return;
              } else {
                // No existing button, ask if they want to add one
                await this.bot.sendMessage(
                  chatId,
                  `This announcement doesn't have a button. Would you like to add one?`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [
                          { 
                            text: '➕ Add Button', 
                            callback_data: `edit_announcement_button_add_${announcementId}` 
                          }
                        ],
                        [
                          { 
                            text: '↩️ Cancel', 
                            callback_data: 'cancel_edit_announcement_button' 
                          }
                        ]
                      ]
                    }
                  }
                );
                return;
              }
            }
            break;
          }
          
          case 'new': {
            if (data[1] === 'announcement') {
              await this.bot.answerCallbackQuery(query.id);
              
              // Delete the announcements list message
              await this.bot.deleteMessage(chatId, query.message.message_id);
              
              // Trigger the /announce command
              await this.bot.sendMessage(
                chatId,
                'Please use the /announce command followed by your announcement text to create a new announcement.'
              );
            }
            break;
          }
          
          case 'cancel': {
            if (data[1] === 'edit' && data[2] === 'announcement') {
              await this.bot.answerCallbackQuery(query.id, { text: 'Edit cancelled.' });
              await this.bot.deleteMessage(chatId, query.message.message_id);
              
              // Refresh announcements list
              await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
            }
            break;
          }
          
          case 'edit': {
            if (data[1] === 'announcement' && data[2] === 'button') {
              if (data[3] === 'add' || data[3] === 'edit') {
                // Add or edit a button
                const announcementId = data[4];
                const announcement = this.announcements.getAnnouncementById(announcementId);
                
                if (!announcement) {
                  await this.bot.answerCallbackQuery(query.id, { text: 'Announcement not found.' });
                  return;
                }
                
                await this.bot.answerCallbackQuery(query.id);
                
                // Delete the options message
                await this.bot.deleteMessage(chatId, query.message.message_id);
                
                // Store the context for updating
                this.editingAnnouncementButton = this.editingAnnouncementButton || {};
                this.editingAnnouncementButton[query.from.id] = { id: announcementId };
                
                // First ask for button text
                const buttonTextPrompt = await this.bot.sendMessage(
                  chatId,
                  'Please enter the button text:',
                  { reply_markup: { force_reply: true } }
                );
                
                this.bot.onReplyToMessage(chatId, buttonTextPrompt.message_id, async (buttonTextMsg) => {
                  const buttonText = buttonTextMsg.text;
                  
                  // Now ask for the button URL
                  const buttonUrlPrompt = await this.bot.sendMessage(
                    chatId,
                    'Please enter the button URL:',
                    { reply_markup: { force_reply: true } }
                  );
                  
                  this.bot.onReplyToMessage(chatId, buttonUrlPrompt.message_id, async (buttonUrlMsg) => {
                    const buttonUrl = buttonUrlMsg.text;
                    
                    // Create the button object
                    const button = {
                      text: buttonText,
                      url: buttonUrl
                    };
                    
                    try {
                      // Update the announcement with the new button
                      const updated = await this.announcements.updateAnnouncement(announcementId, { button });
                      
                      if (updated) {
                        await this.bot.sendMessage(
                          chatId,
                          `✅ Button ${data[3] === 'add' ? 'added' : 'updated'} successfully!`
                        );
                      } else {
                        await this.bot.sendMessage(
                          chatId,
                          `❌ Failed to ${data[3] === 'add' ? 'add' : 'update'} button.`
                        );
                      }
                      
                      // Clean up
                      delete this.editingAnnouncementButton[query.from.id];
                      
                      // Refresh announcements list
                      await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
                    } catch (error) {
                      await this.bot.sendMessage(
                        chatId,
                        `❌ Error updating button: ${error.message}`
                      );
                    }
                  });
                });
              } else if (data[3] === 'remove') {
                // Remove a button
                const announcementId = data[4];
                
                try {
                  // Remove the button by setting it to null
                  const updated = await this.announcements.updateAnnouncement(announcementId, { button: null });
                  
                  if (updated) {
                    await this.bot.answerCallbackQuery(query.id, { text: 'Button removed successfully.' });
                  } else {
                    await this.bot.answerCallbackQuery(query.id, { text: 'Failed to remove button.' });
                  }
                  
                  // Delete the options message
                  await this.bot.deleteMessage(chatId, query.message.message_id);
                  
                  // Refresh announcements list
                  await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
                } catch (error) {
                  await this.bot.answerCallbackQuery(query.id, { text: `Error: ${error.message}` });
                }
              }
            }
            break;
          }
          
          case 'cancel': {
            if (data[1] === 'edit' && data[2] === 'announcement' && data[3] === 'button') {
              await this.bot.answerCallbackQuery(query.id, { text: 'Button edit cancelled.' });
              await this.bot.deleteMessage(chatId, query.message.message_id);
              
              // Refresh announcements list
              await this.bot.onText.handlers.find(h => h.regexp.toString().includes('announcements'))?._callback({ chat: { id: chatId } });
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
      
      // Show posting status for each service
      let statusIcons = '';
      if (item.postedTo) {
        if (item.postedTo.telegram) statusIcons += '✅TG ';
        else statusIcons += '❌TG ';
        
        if (queueManager.postServices.includes('discord')) {
          if (item.postedTo.discord) statusIcons += '✅DS';
          else statusIcons += '❌DS';
        }
      }
      
      message += `${itemIndex}. ${itemType} *${item.title}*\n   From: ${item.siteName} ${statusIcons}\n`;
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

  /**
   * Check if the user is the owner of the bot
   * @param {number} userId - The Telegram user ID to check
   * @returns {boolean} - Whether the user is the owner
   */
  isOwner(userId) {
    return config.ownerId && userId.toString() === config.ownerId.toString();
  }

  /**
   * Post media (image or video) to the Telegram channel
   * @param {Object} mediaData - The media data to post
   * @returns {Promise<boolean>} - Whether posting was successful
   */
  async postMedia(mediaData) {
    try {
      // Create inline keyboard with link to source
      let buttonText = `View on ${mediaData.siteName}`;
      
      // Special butterfly emojis for Bluesky
      if (mediaData.siteName === 'Bluesky') {
        buttonText = `🦋 ${buttonText} 🦋`;
      }
      
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: buttonText,
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
  /**
   * Helper method to ask about adding a button to an announcement
   * @param {number} chatId - The chat ID where to send the message
   * @param {number} userId - The user ID for tracking state
   */
  askAboutButton(chatId, userId) {
    this.bot.sendMessage(
      chatId,
      'Would you like to add a button with a link to this announcement?',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Yes', callback_data: 'add_button' },
              { text: 'No', callback_data: 'skip_button' }
            ]
          ]
        }
      }
    );
  }
  
  /**
   * Helper method to show announcement confirmation
   * @param {number} chatId - The chat ID where to send the message
   * @param {number} userId - The user ID for tracking state
   * @param {string} name - Announcement name
   * @param {string} message - Announcement message
   * @param {string} cronSchedule - Cron schedule
   * @param {Object} button - Button object (optional)
   */
  async showAnnouncementConfirmation(chatId, userId, name, message, cronSchedule, button = null) {
    // Store all the data for the confirmation callback
    this.confirmAnnouncement = this.confirmAnnouncement || {};
    this.confirmAnnouncement[userId] = {
      name,
      message,
      cronSchedule,
      button
    };
    
    // Create confirmation message with all details
    let confirmationMessage = "📣 *Announcement Preview*\n\n";
    confirmationMessage += `*Name*: ${name || "(Auto-generated)"}\n`;
    confirmationMessage += `*Schedule*: \`${cronSchedule}\`\n`;
    
    if (button) {
      confirmationMessage += `*Button*: "${button.text}" → ${button.url}\n`;
    } else {
      confirmationMessage += "*Button*: None\n";
    }
    
    confirmationMessage += "\n*Message Preview*:\n------------------\n";
    
    // Send confirmation message
    await this.bot.sendMessage(
      chatId,
      confirmationMessage,
      { parse_mode: 'Markdown' }
    );
    
    // Send formatted message preview
    const formattedMessage = this.announcements.formatMessageText(message);
    await this.bot.sendMessage(
      chatId,
      formattedMessage,
      { parse_mode: 'HTML' }
    );
    
    // Ask for confirmation
    await this.bot.sendMessage(
      chatId,
      "Does everything look correct? Ready to create this announcement?",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Create Announcement', callback_data: 'confirm_announcement' },
              { text: '❌ Cancel', callback_data: 'cancel_announcement' }
            ]
          ]
        }
      }
    );
    
    // Set up a one-time listener for the confirmation response
    this.bot.once('callback_query', async (query) => {
      if (query.from.id !== userId) return; // Make sure it's the same user
      
      await this.bot.answerCallbackQuery(query.id);
      
      if (query.data === 'confirm_announcement') {
        try {
          // Create the announcement
          const announcement = await this.announcements.addAnnouncement(
            message,
            cronSchedule,
            name,
            button
          );
          
          // Send success message
          let successMessage = `✅ Announcement "${announcement.name}" created!\n\n`;
          successMessage += `Scheduled for: ${announcement.cronSchedule}\n\n`;
          
          if (button) {
            successMessage += `Button: "${button.text}" → ${button.url}\n\n`;
          }
          
          successMessage += "You can manage all announcements with /announcements";
          
          await this.bot.sendMessage(chatId, successMessage);
          
          // Clean up
          delete this.pendingAnnouncements[userId];
          delete this.confirmAnnouncement[userId];
        } catch (error) {
          this.bot.sendMessage(
            chatId,
            `Error creating announcement: ${error.message}\n\nPlease try again.`
          );
        }
      } else {
        // User canceled
        await this.bot.sendMessage(
          chatId,
          "Announcement creation canceled. You can start over with /announce"
        );
        
        // Clean up
        delete this.pendingAnnouncements[userId];
        delete this.confirmAnnouncement[userId];
      }
    });
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
      
      return true;
    } catch (error) {
      console.error('Error shutting down bot:', error);
      return false;
    }
  }
}

module.exports = StagehandBot;