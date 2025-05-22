/**
 * Announcement Manager for scheduled text announcements
 * Handles multiple announcements with individual cron schedules
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

class AnnouncementManager {
  constructor(telegramBot) {
    this.telegramBot = telegramBot;
    this.announcements = [];
    this.cronJobs = {};
    this.filePath = path.join(__dirname, '..', 'announcements.json');
    this.initialized = false;
  }

  /**
   * Initialize the announcement manager
   */
  async init() {
    if (this.initialized) return;
    
    try {
      await this.loadAnnouncementsFromDisk();
      this.scheduleAllAnnouncements();
      this.initialized = true;
      console.log('Announcement manager initialized');
    } catch (error) {
      console.error('Error initializing announcement manager:', error);
      // If loading fails, start with empty announcements
      this.announcements = [];
      await this.saveAnnouncementsToDisk();
    }
  }

  /**
   * Load announcements from disk
   */
  async loadAnnouncementsFromDisk() {
    try {
      // Check if the file exists
      if (!fs.existsSync(this.filePath)) {
        // Create an empty announcements file
        this.announcements = [];
        await this.saveAnnouncementsToDisk();
        return;
      }

      // Read and parse the file
      const data = await readFileAsync(this.filePath, 'utf8');
      this.announcements = JSON.parse(data);
      console.log(`Loaded ${this.announcements.length} announcements from disk`);
    } catch (error) {
      console.error('Error loading announcements from disk:', error);
      throw error;
    }
  }

  /**
   * Save announcements to disk
   */
  async saveAnnouncementsToDisk() {
    try {
      const data = JSON.stringify(this.announcements, null, 2);
      await writeFileAsync(this.filePath, data, 'utf8');
      console.log(`Saved ${this.announcements.length} announcements to disk`);
      return true;
    } catch (error) {
      console.error('Error saving announcements to disk:', error);
      return false;
    }
  }

  /**
   * Add a new announcement
   * @param {string} message - The text message to post
   * @param {string} cronSchedule - Cron expression for schedule
   * @param {string} name - Optional name/label for the announcement
   * @param {Object} button - Optional button configuration {text: string, url: string}
   * @returns {Promise<Object>} - The added announcement object
   */
  async addAnnouncement(message, cronSchedule, name = '', button = null) {
    // Validate cron expression
    if (!this.isValidCronExpression(cronSchedule)) {
      throw new Error('Invalid cron expression');
    }

    // Validate button if provided
    if (button && (!button.text || !button.url)) {
      throw new Error('Button must have both text and url properties');
    }
    
    // Store the raw message - ensure we preserve line breaks
    // No additional processing, just use the message as-is
    const rawMessage = message;

    // Create new announcement
    const id = Date.now().toString();
    const announcement = {
      id,
      message: rawMessage, // Use the raw message with preserved line breaks
      cronSchedule,
      name: name || `Announcement ${id.substring(id.length - 4)}`,
      createdAt: new Date().toISOString(),
      lastRun: null,
      button: button
    };

    // Add to our list
    this.announcements.push(announcement);
    
    // Save changes
    await this.saveAnnouncementsToDisk();
    
    // Schedule it
    this.scheduleAnnouncement(announcement);
    
    return announcement;
  }

  /**
   * Remove an announcement by its ID
   * @param {string} id - Announcement ID to remove
   * @returns {Promise<boolean>} - Whether removal was successful
   */
  async removeAnnouncement(id) {
    const index = this.announcements.findIndex(a => a.id === id);
    
    if (index === -1) {
      return false;
    }
    
    // Stop the cron job
    if (this.cronJobs[id]) {
      this.cronJobs[id].stop();
      delete this.cronJobs[id];
    }
    
    // Remove from array
    this.announcements.splice(index, 1);
    
    // Save changes
    await this.saveAnnouncementsToDisk();
    
    return true;
  }

  /**
   * Update an existing announcement
   * @param {string} id - ID of the announcement to update
   * @param {Object} updates - Object with fields to update (message, cronSchedule, or name)
   * @returns {Promise<Object>} - The updated announcement
   */
  async updateAnnouncement(id, updates) {
    const index = this.announcements.findIndex(a => a.id === id);
    
    if (index === -1) {
      throw new Error('Announcement not found');
    }
    
    const announcement = this.announcements[index];
    
    // Update fields
    if (updates.message !== undefined) {
      // Store the raw message exactly as received, preserving all line breaks
      // Do not trim() as it can remove important whitespace
      announcement.message = updates.message;
    }
    
    if (updates.name !== undefined) {
      announcement.name = updates.name;
    }
    
    if (updates.cronSchedule !== undefined) {
      if (!this.isValidCronExpression(updates.cronSchedule)) {
        throw new Error('Invalid cron expression');
      }
      
      announcement.cronSchedule = updates.cronSchedule;
      
      // Update the schedule
      if (this.cronJobs[id]) {
        this.cronJobs[id].stop();
      }
      this.scheduleAnnouncement(announcement);
    }
    
    // Save changes
    await this.saveAnnouncementsToDisk();
    
    return announcement;
  }

  /**
   * Get all announcements
   * @returns {Array} - Array of announcement objects
   */
  getAnnouncements() {
    return [...this.announcements];
  }

  /**
   * Get a specific announcement by ID
   * @param {string} id - The announcement ID
   * @returns {Object|null} - The announcement object or null if not found
   */
  getAnnouncementById(id) {
    return this.announcements.find(a => a.id === id) || null;
  }

  /**
   * Schedule a single announcement
   * @param {Object} announcement - The announcement to schedule
   */
  scheduleAnnouncement(announcement) {
    // Cancel existing job if it exists
    if (this.cronJobs[announcement.id]) {
      this.cronJobs[announcement.id].stop();
    }
    
    // Create new cron job
    this.cronJobs[announcement.id] = cron.schedule(announcement.cronSchedule, async () => {
      try {
        console.log(`Running scheduled announcement: ${announcement.name}`);
        
        // Create message options with HTML support which handles line breaks better
        const messageOptions = { parse_mode: 'HTML' };
        
        // Process the message to handle line breaks properly in HTML mode
        // Convert line breaks to HTML breaks and escape any HTML entities
        let processedMessage = this.formatMessageText(announcement.message);
        
        // Add inline keyboard if a button is defined
        if (announcement.button && announcement.button.text && announcement.button.url) {
          messageOptions.reply_markup = {
            inline_keyboard: [
              [
                {
                  text: announcement.button.text,
                  url: announcement.button.url
                }
              ]
            ]
          };
        }
        
        // Send the announcement message to the channel
        const result = await this.telegramBot.bot.sendMessage(
          this.telegramBot.channelId, 
          processedMessage,
          messageOptions
        );
        
        // Update last run time
        const index = this.announcements.findIndex(a => a.id === announcement.id);
        if (index !== -1) {
          this.announcements[index].lastRun = new Date().toISOString();
          await this.saveAnnouncementsToDisk();
        }
        
        console.log(`Successfully sent announcement: ${announcement.name}`);
      } catch (error) {
        console.error(`Error sending announcement ${announcement.name}:`, error);
      }
    });
    
    console.log(`Scheduled announcement: ${announcement.name} with cron: ${announcement.cronSchedule}`);
  }

  /**
   * Schedule all announcements
   */
  scheduleAllAnnouncements() {
    // Clear existing jobs
    Object.values(this.cronJobs).forEach(job => job.stop());
    this.cronJobs = {};
    
    // Schedule each announcement
    this.announcements.forEach(announcement => {
      this.scheduleAnnouncement(announcement);
    });
    
    console.log(`Scheduled ${this.announcements.length} announcements`);
  }

  /**
   * Validate a cron expression
   * @param {string} cronExpression - The cron expression to validate
   * @returns {boolean} - Whether the expression is valid
   */
  isValidCronExpression(cronExpression) {
    return cron.validate(cronExpression);
  }
  
  /**
   * Format message text to properly handle line breaks and special formatting
   * @param {string} text - The original message text
   * @returns {string} - Formatted message text for Telegram
   */
  formatMessageText(text) {
    if (!text) return '';
    
    // Escape HTML special characters
    let formattedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Line breaks are preserved automatically in Telegram's HTML mode
    // Do NOT replace newlines with <br/> tags as Telegram doesn't support them
    
    // Handle common markdown-style formatting with multiline support
    // Process text in a way that handles multiline content properly
    // Uses non-greedy quantifiers (.*?) and the 's' flag to match across multiple lines
    formattedText = formattedText.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');
    formattedText = formattedText.replace(/\*([\s\S]*?)\*/g, '<i>$1</i>');
    formattedText = formattedText.replace(/__([\s\S]*?)__/g, '<u>$1</u>');
    formattedText = formattedText.replace(/~~([\s\S]*?)~~/g, '<s>$1</s>');
    
    return formattedText;
  }

  /**
   * Send an announcement immediately (one-time)
   * @param {string} id - ID of the announcement to send
   * @returns {Promise<boolean>} - Whether sending was successful
   */
  async sendAnnouncementNow(id) {
    const announcement = this.getAnnouncementById(id);
    
    if (!announcement) {
      return false;
    }
    
    try {
      // Create message options with HTML support
      const messageOptions = { parse_mode: 'HTML' };
      
      // Process the message to handle line breaks properly in HTML mode
      let processedMessage = this.formatMessageText(announcement.message);
      
      // Add inline keyboard if a button is defined
      if (announcement.button && announcement.button.text && announcement.button.url) {
        messageOptions.reply_markup = {
          inline_keyboard: [
            [
              {
                text: announcement.button.text,
                url: announcement.button.url
              }
            ]
          ]
        };
      }
      
      await this.telegramBot.bot.sendMessage(
        this.telegramBot.channelId, 
        processedMessage,
        messageOptions
      );
      
      // Update last run time
      const index = this.announcements.findIndex(a => a.id === id);
      if (index !== -1) {
        this.announcements[index].lastRun = new Date().toISOString();
        await this.saveAnnouncementsToDisk();
      }
      
      return true;
    } catch (error) {
      console.error(`Error sending announcement ${announcement.name}:`, error);
      return false;
    }
  }

  /**
   * Shutdown the announcement manager
   */
  shutdown() {
    // Stop all cron jobs
    Object.values(this.cronJobs).forEach(job => job.stop());
    this.cronJobs = {};
    console.log('Announcement manager shutdown complete');
  }
}

module.exports = AnnouncementManager;