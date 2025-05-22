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
      if (fetchResult.stdout) {
        console.log(fetchResult.stdout);
      }
      
      // Check if there are any changes to pull
      const statusResult = await execAsync('git rev-list HEAD..origin/main --count');
      const changeCount = parseInt(statusResult.stdout.trim(), 10);
      
      if (changeCount > 0) {
        console.log(`Found ${changeCount} new commit(s), pulling updates...`);
        
        // Save current HEAD for comparison after pull
        const oldHead = await execAsync('git rev-parse HEAD');
        const oldHeadHash = oldHead.stdout.trim();
        
        // Pull the changes
        const pullResult = await execAsync('git pull origin main');
        console.log(pullResult.stdout);
        
        // Get the new HEAD
        const newHead = await execAsync('git rev-parse HEAD');
        const newHeadHash = newHead.stdout.trim();
        
        // Show change statistics
        if (oldHeadHash !== newHeadHash) {
          const changeStats = await this.getChangeStats(oldHeadHash, newHeadHash);
          if (changeStats) {
            console.log(changeStats);
          }
        }
        
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
   * Get statistics about changes between current and updated code
   * @param {string} fromRef - Starting reference (e.g., HEAD)
   * @param {string} toRef - Ending reference (e.g., origin/main)
   * @returns {Promise<string>} Formatted string showing changes
   */
  async getChangeStats(fromRef, toRef) {
    try {
      // Get the abbreviated hashes for display
      const shortFromRef = await execAsync(`git rev-parse --short ${fromRef}`);
      const shortToRef = await execAsync(`git rev-parse --short ${toRef}`);
      const fromRefShort = shortFromRef.stdout.trim();
      const toRefShort = shortToRef.stdout.trim();
      
      // Show what we're updating from/to
      let output = `Updating ${fromRefShort}..${toRefShort}\n`;
      
      // Add the fast-forward indicator that Git shows
      output += "Fast-forward\n";
      
      // Use git diff --stat which shows the files changed and +/- indicators
      // Use --numstat to get the raw numbers for insertions and deletions
      const numstatResult = await execAsync(`git diff --numstat ${fromRef} ${toRef}`);
      const numstatLines = numstatResult.stdout.trim().split('\n').filter(Boolean);
      
      // Track total insertions and deletions
      let totalInsertions = 0;
      let totalDeletions = 0;
      
      // Process each line to format it like Git's output
      const fileChanges = [];
      for (const line of numstatLines) {
        const [insertions, deletions, path] = line.split('\t');
        
        // Skip binary files or files with unusual output
        if (insertions === '-' || deletions === '-') continue;
        
        const insCount = parseInt(insertions, 10) || 0;
        const delCount = parseInt(deletions, 10) || 0;
        
        totalInsertions += insCount;
        totalDeletions += delCount;
        
        // Format file name with change counts
        const plusMinus = '+'.repeat(Math.min(insCount, 70)) + '-'.repeat(Math.min(delCount, 70));
        const changeStats = `${plusMinus}`;
        
        // Calculate the proper width for the file path (similar to Git's output)
        const maxWidth = 80; // approximate width for console
        const reserved = 10;  // space reserved for the stats part
        const width = Math.min(path.length, maxWidth - reserved - changeStats.length);
        const truncatedPath = path.length > width ? path.substring(0, width) : path;
        const paddedPath = truncatedPath.padEnd(width);
        
        fileChanges.push(`${paddedPath} | ${changeStats}`);
      }
      
      // Add each file's changes to the output
      fileChanges.forEach(fc => {
        output += ` ${fc}\n`;
      });
      
      // Add the summary line
      const filesChanged = numstatLines.length;
      output += `\n ${filesChanged} file${filesChanged !== 1 ? 's' : ''} changed, `;
      output += `${totalInsertions} insertion${totalInsertions !== 1 ? 's' : ''}(+), `;
      output += `${totalDeletions} deletion${totalDeletions !== 1 ? 's' : ''}(-)`;
      
      return output;
    } catch (error) {
      console.error('Error getting change stats:', error);
      return '';
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
      // Fetch changes from remote
      const fetchResult = await execAsync('git fetch origin main');
      if (fetchResult.stdout) {
        console.log(fetchResult.stdout);
      }
      
      const statusResult = await execAsync('git rev-list HEAD..origin/main --count');
      const changeCount = parseInt(statusResult.stdout.trim(), 10);
      
      if (changeCount > 0) {
        // Save current HEAD for comparison
        const oldHead = await execAsync('git rev-parse HEAD');
        const oldHeadHash = oldHead.stdout.trim();
        
        // Pull the changes
        const pullResult = await execAsync('git pull origin main');
        console.log(pullResult.stdout);
        
        // Get the new HEAD
        const newHead = await execAsync('git rev-parse HEAD');
        const newHeadHash = newHead.stdout.trim();
        
        // Show change statistics
        if (oldHeadHash !== newHeadHash) {
          const changeStats = await this.getChangeStats(oldHeadHash, newHeadHash);
          if (changeStats) {
            console.log(changeStats);
          }
        }
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error during manual update:', error);
      return false;
    }
  }

  /**
   * Test function to display change statistics between commits
   * @param {number} [commitRange=1] - Number of commits to go back from HEAD
   * @returns {Promise<void>}
   */
  async testChangeStats(commitRange = 1) {
    try {
      console.log(`Testing change statistics for the last ${commitRange} commit(s)...`);
      
      // Get the current HEAD
      const head = await execAsync('git rev-parse HEAD');
      const headHash = head.stdout.trim();
      
      // Get the commit before HEAD~n
      const prevHead = await execAsync(`git rev-parse HEAD~${commitRange}`);
      const prevHeadHash = prevHead.stdout.trim();
      
      console.log(`Comparing changes between ${prevHeadHash.substring(0, 7)} and ${headHash.substring(0, 7)}`);
      
      // Get and display the change statistics
      const changeStats = await this.getChangeStats(prevHeadHash, headHash);
      if (changeStats) {
        console.log('\n--- Change Statistics ---');
        console.log(changeStats);
        console.log('------------------------\n');
      } else {
        console.log('No change statistics available');
      }
    } catch (error) {
      console.error('Error testing change stats:', error);
    }
  }
}

module.exports = new Updater();
