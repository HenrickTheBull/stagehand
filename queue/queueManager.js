const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const config = require('../config');

class QueueManager {
  constructor() {
    // Allow custom queue file location via environment variable
    this.queueFile = config.queueFilePath || path.join(__dirname, 'queue.json');
    this.queueBackupFile = `${this.queueFile}.backup`;
    this.cronSchedule = config.defaultCronSchedule;
    this.imagesPerInterval = config.imagesPerInterval;
    this.scheduledTask = null;
    this.autoSaveInterval = null;
    this.queueData = { queue: [] };
    this.postServices = ['telegram'];
    
    // Add Discord to services if enabled
    if (config.discord?.enabled) {
      this.postServices.push('discord');
    }
    
    this.initialize();
  }

  async initialize() {
    await this.loadQueueFromDisk();
    this.startAutoSave();
    
    // Log queue status on startup
    const queueLength = this.queueData.queue.length;
    console.log(`Queue loaded with ${queueLength} item${queueLength !== 1 ? 's' : ''}`);
    
    // Initialize service tracking for any existing items that don't have it
    this.initializeServiceTracking();
  }

  /**
   * Initialize service tracking for items that don't have it yet
   */
  initializeServiceTracking() {
    let updated = false;
    
    for (let i = 0; i < this.queueData.queue.length; i++) {
      const item = this.queueData.queue[i];
      
      // If the item doesn't have a postedTo property, initialize it
      if (!item.postedTo) {
        this.queueData.queue[i].postedTo = {};
        this.postServices.forEach(service => {
          this.queueData.queue[i].postedTo[service] = false;
        });
        updated = true;
      }
      
      // Initialize sourceImgUrl if not present
      if (!item.sourceImgUrl) {
        // Try to set sourceImgUrl from existing data
        if (item.originalImageUrl) {
          this.queueData.queue[i].sourceImgUrl = item.originalImageUrl;
          updated = true;
        } else if (item.downloadUrl) {
          this.queueData.queue[i].sourceImgUrl = item.downloadUrl;
          updated = true;
        }
      }
    }
    
    if (updated) {
      this.saveQueueToDisk()
        .then(() => console.log('Queue items updated with service tracking and sourceImgUrl'))
        .catch(err => console.error('Error initializing service tracking:', err));
    }
  }

  /**
   * Start auto-saving the queue periodically
   */
  startAutoSave() {
    // Auto-save the queue every 5 minutes
    const autoSaveMinutes = 5;
    this.autoSaveInterval = setInterval(() => {
      this.saveQueueToDisk()
        .then(() => console.log(`Queue auto-saved (${this.queueData.queue.length} items)`))
        .catch(err => console.error('Error auto-saving queue:', err));
    }, autoSaveMinutes * 60 * 1000);
  }

  /**
   * Load queue data from disk with error recovery
   */
  async loadQueueFromDisk() {
    try {
      // Check if main queue file exists
      if (await fs.pathExists(this.queueFile)) {
        try {
          const content = await fs.readJson(this.queueFile);
          if (content && Array.isArray(content.queue)) {
            this.queueData = content;
            return;
          }
        } catch (mainError) {
          console.error('Error reading main queue file:', mainError);
          
          // Try to recover from backup if main file is corrupted
          if (await fs.pathExists(this.queueBackupFile)) {
            try {
              console.log('Attempting to recover queue from backup file...');
              const backupContent = await fs.readJson(this.queueBackupFile);
              if (backupContent && Array.isArray(backupContent.queue)) {
                this.queueData = backupContent;
                await this.saveQueueToDisk(); // Update the main file
                console.log('Queue successfully recovered from backup');
                return;
              }
            } catch (backupError) {
              console.error('Error reading backup queue file:', backupError);
            }
          }
        }
      }
      
      // If we reach here, initialize an empty queue
      this.queueData = { queue: [] };
      await this.saveQueueToDisk();
    } catch (error) {
      console.error('Error during queue initialization:', error);
      this.queueData = { queue: [] };
    }
  }

  /**
   * Save queue to disk with atomic write operations
   */
  async saveQueueToDisk() {
    try {
      // First, update the backup file
      await fs.writeJson(this.queueBackupFile, this.queueData, { spaces: 2 });
      
      // Then, atomically replace the main queue file
      const tempFile = `${this.queueFile}.temp`;
      await fs.writeJson(tempFile, this.queueData, { spaces: 2 });
      await fs.move(tempFile, this.queueFile, { overwrite: true });
      
      return true;
    } catch (error) {
      console.error('Error saving queue to disk:', error);
      return false;
    }
  }

  async getQueue() {
    return this.queueData.queue || [];
  }

  async addToQueue(imageData) {
    try {
      // Initialize postedTo tracking for all services
      const postedTo = {};
      this.postServices.forEach(service => {
        postedTo[service] = false;
      });
      
      // Determine the sourceImgUrl from available data
      let sourceImgUrl = null;
      
      // Check various possible sources for the raw upstream URL
      if (imageData.originalImageUrl && imageData.originalImageUrl.startsWith('http')) {
        sourceImgUrl = imageData.originalImageUrl;
      } else if (imageData.downloadUrl && imageData.downloadUrl.startsWith('http')) {
        sourceImgUrl = imageData.downloadUrl;
      } else if (imageData.imageUrl && imageData.imageUrl.startsWith('http')) {
        // Only use imageUrl if it's a web URL, not a local path
        sourceImgUrl = imageData.imageUrl;
      }
      
      console.log(`Adding item to queue with sourceImgUrl: ${sourceImgUrl || 'none'}`);
      
      this.queueData.queue.push({
        ...imageData,
        timestamp: new Date().toISOString(),
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        postedTo,
        sourceImgUrl // Add the new field
      });
      
      await this.saveQueueToDisk();
      return true;
    } catch (error) {
      console.error('Error adding to queue:', error);
      return false;
    }
  }

  async getNextFromQueue() {
    if (this.queueData.queue.length === 0) {
      return null;
    }
    return this.queueData.queue[0];
  }

  /**
   * Mark an item as posted by a specific service
   * @param {number} index - Index of the item in the queue
   * @param {string} service - Service name (e.g., 'telegram', 'discord')
   * @returns {Promise<boolean>} - Whether marking was successful
   */
  async markPostedByService(index = 0, service) {
    try {
      if (this.queueData.queue.length === 0 || index >= this.queueData.queue.length) {
        return false;
      }
      
      // Make sure the service is valid
      if (!this.postServices.includes(service)) {
        console.warn(`Unknown service: ${service}`);
        return false;
      }
      
      // Mark the item as posted by the service
      if (!this.queueData.queue[index].postedTo) {
        this.queueData.queue[index].postedTo = {};
      }
      
      this.queueData.queue[index].postedTo[service] = true;
      
      // Check if all services have posted the item
      const allPosted = this.postServices.every(s => 
        this.queueData.queue[index].postedTo[s] === true
      );
      
      // If all services have posted, remove the item
      if (allPosted) {
        const removed = this.queueData.queue.splice(index, 1)[0];
        console.log(`All services posted item: ${removed.title}, removed from queue`);
      }
      
      await this.saveQueueToDisk();
      return true;
    } catch (error) {
      console.error('Error marking item as posted:', error);
      return false;
    }
  }

  /**
   * Check if an item has been posted by a specific service
   * @param {number} index - Index of the item in the queue
   * @param {string} service - Service name
   * @returns {boolean} - Whether the item has been posted by the service
   */
  hasBeenPostedByService(index = 0, service) {
    if (this.queueData.queue.length === 0 || index >= this.queueData.queue.length) {
      return false;
    }
    
    const item = this.queueData.queue[index];
    return item.postedTo && item.postedTo[service] === true;
  }

  /**
   * Get the next item that has not been posted by a specific service
   * @param {string} service - Service name
   * @returns {Object|null} - Next item to post or null if none found
   */
  async getNextForService(service) {
    for (let i = 0; i < this.queueData.queue.length; i++) {
      const item = this.queueData.queue[i];
      if (item.postedTo && item.postedTo[service] === false) {
        return { item, index: i };
      }
    }
    return null;
  }

  /**
   * Force remove an item from queue regardless of posting status
   * @param {number} index - Index of the item to remove
   * @returns {Promise<Object|null>} - The removed item or null if not found
   */
  async removeFromQueue(index = 0) {
    try {
      if (this.queueData.queue.length === 0 || index >= this.queueData.queue.length) {
        return null;
      }
      
      const removed = this.queueData.queue.splice(index, 1)[0];
      await this.saveQueueToDisk();
      return removed;
    } catch (error) {
      console.error('Error removing from queue:', error);
      return null;
    }
  }

  async getQueueLength() {
    return this.queueData.queue.length;
  }

  setCronSchedule(schedule) {
    try {
      if (this.scheduledTask) {
        this.scheduledTask.stop();
      }
      
      // Validate the schedule
      if (cron.validate(schedule)) {
        this.cronSchedule = schedule;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error setting cron schedule:', error);
      return false;
    }
  }

  setImagesPerInterval(count) {
    if (typeof count !== 'number' || count < 1) {
      return false;
    }
    this.imagesPerInterval = count;
    return true;
  }

  /**
   * Start scheduler with multi-service support
   * @param {Object} postFunctions - Object mapping service names to post functions
   * @returns {boolean} - Whether scheduler was started successfully
   */
  startScheduler(postFunctions) {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
    }

    try {
      this.scheduledTask = cron.schedule(this.cronSchedule, async () => {
        console.log('Running scheduled post task...');
        
        for (let i = 0; i < this.imagesPerInterval; i++) {
          // Get next item that needs processing by any service
          const nextImage = await this.getNextFromQueue();
          if (!nextImage) {
            console.log('Queue is empty, nothing to post');
            break;
          }
          
          // Process for each service
          let atLeastOneServicePosted = false;
          
          for (const service of this.postServices) {
            // Skip if this service already posted this item
            if (this.hasBeenPostedByService(0, service)) {
              console.log(`Item "${nextImage.title}" already posted by ${service}, skipping`);
              continue;
            }
            
            // Get post function for this service
            const postFunction = postFunctions[service];
            if (!postFunction) {
              console.warn(`No post function for service: ${service}`);
              continue;
            }
            
            // Post the item with this service
            const success = await postFunction(nextImage);
            
            if (success) {
              await this.markPostedByService(0, service);
              console.log(`Posted to ${service}: ${nextImage.title || 'Untitled'}`);
              atLeastOneServicePosted = true;
            } else {
              console.error(`Failed to post to ${service}: ${nextImage.title || 'Untitled'}`);
            }
          }
          
          if (!atLeastOneServicePosted) {
            console.error(`Failed to post item: ${nextImage.title || 'Untitled'} to any service`);
            break; // Stop trying if posting fails for all services
          }
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error starting scheduler:', error);
      return false;
    }
  }

  stopScheduler() {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }
    
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
    
    // Save queue one last time before stopping
    return this.saveQueueToDisk();
  }
  
  /**
   * Clean up resources on application shutdown
   */
  async shutdown() {
    this.stopScheduler();
    return this.saveQueueToDisk();
  }
}

module.exports = new QueueManager();