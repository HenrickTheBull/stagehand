/**
 * Auto-updater for Stagehand bot
 * Checks for updates from GitHub repository and restarts the bot using PM2 if updates are found
 */
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class Updater {
  constructor() {
    this.repoUrl = 'https://github.com/HenrickTheBull/stagehand';
    this.updateIntervalMs = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
    this.updateInterval = null;
    this.isDevMode = process.env.NODE_ENV === 'development' || 
                     process.argv.includes('dev') || 
                     process.env.DEV_MODE === 'true';
  }

  /**
   * Start the auto-updater
   */
  start() {
    // Don't start the updater in dev mode
    if (this.isDevMode) {
      console.log('Running in development mode, auto-updater disabled');
      return;
    }

    console.log('Starting auto-updater, will check for updates every 12 hours');
    
    // Run initial check
    this.checkForUpdates();
    
    // Set up interval for future checks
    this.updateInterval = setInterval(() => {
      this.checkForUpdates();
    }, this.updateIntervalMs);
  }

  /**
   * Stop the auto-updater
   */
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('Auto-updater stopped');
    }
  }

  /**
   * Check for updates from the GitHub repository
   */
  async checkForUpdates() {
    try {
      console.log('Checking for updates...');
      
      // Fetch latest changes from origin without merging
      const fetchResult = await execAsync('git fetch origin main');
      console.log('Fetch result:', fetchResult.stdout || 'No output');
      
      // Check if there are any changes to pull
      const statusResult = await execAsync('git rev-list HEAD..origin/main --count');
      const changeCount = parseInt(statusResult.stdout.trim(), 10);
      
      if (changeCount > 0) {
        console.log(`Found ${changeCount} new commit(s), pulling updates...`);
        
        // Pull the changes
        const pullResult = await execAsync('git pull origin main');
        console.log('Pull result:', pullResult.stdout);
        
        // Restart the bot using PM2
        console.log('Restarting bot with PM2...');
        await execAsync('pm2 restart --update-env stagehand');
        console.log('Bot restarted successfully');
      } else {
        console.log('No updates found');
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
    }
  }

  /**
   * Check if an update is available (without applying it)
   * @returns {Promise<boolean>} True if updates are available
   */
  async isUpdateAvailable() {
    try {
      await execAsync('git fetch origin main');
      const statusResult = await execAsync('git rev-list HEAD..origin/main --count');
      const changeCount = parseInt(statusResult.stdout.trim(), 10);
      return changeCount > 0;
    } catch (error) {
      console.error('Error checking if update is available:', error);
      return false;
    }
  }

  /**
   * Manually trigger an update check
   * @returns {Promise<boolean>} True if updates were applied
   */
  async manualUpdate() {
    try {
      await execAsync('git fetch origin main');
      const statusResult = await execAsync('git rev-list HEAD..origin/main --count');
      const changeCount = parseInt(statusResult.stdout.trim(), 10);
      
      if (changeCount > 0) {
        const pullResult = await execAsync('git pull origin main');
        console.log('Manual update result:', pullResult.stdout);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error during manual update:', error);
      return false;
    }
  }
}

module.exports = new Updater();
