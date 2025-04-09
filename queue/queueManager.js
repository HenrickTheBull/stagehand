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
    this.initialize();
  }

  async initialize() {
    await this.loadQueueFromDisk();
    this.startAutoSave();
    
    // Log queue status on startup
    const queueLength = this.queueData.queue.length;
    console.log(`Queue loaded with ${queueLength} item${queueLength !== 1 ? 's' : ''}`);
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
      this.queueData.queue.push({
        ...imageData,
        timestamp: new Date().toISOString(),
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
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

  startScheduler(postFunction) {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
    }

    try {
      this.scheduledTask = cron.schedule(this.cronSchedule, async () => {
        console.log('Running scheduled post task...');
        for (let i = 0; i < this.imagesPerInterval; i++) {
          const nextImage = await this.getNextFromQueue();
          if (nextImage) {
            const success = await postFunction(nextImage);
            if (success) {
              await this.removeFromQueue();
              console.log(`Posted image: ${nextImage.title || 'Untitled'}`);
            } else {
              console.error(`Failed to post image: ${nextImage.title || 'Untitled'}`);
              break; // Stop trying if posting fails
            }
          } else {
            console.log('Queue is empty, nothing to post');
            break;
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