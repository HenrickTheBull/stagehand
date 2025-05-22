/**
 * Discord webhook integration for Stagehand
 * Sends media posts to a Discord channel via webhook using embeds
 */
const axios = require('axios');
const config = require('../config');
const path = require('path');
const fs = require('fs').promises;

class DiscordWebhook {
  constructor() {
    this.webhookUrl = config.discord?.webhookUrl;
    this.enabled = config.discord?.enabled;
    
    if (!this.webhookUrl) {
      console.warn('Discord webhook URL not configured. Discord integration disabled.');
    } else if (this.enabled === false) {
      console.log('Discord webhook URL is configured but integration is disabled in settings.');
    } else {
      console.log('Discord webhook integration initialized.');
    }
  }
  
  /**
   * Check if Discord integration is enabled
   * @returns {boolean} - Whether Discord integration is enabled
   */
  isEnabled() {
    // Only return true if both the webhook URL is set AND explicitly enabled in config
    return !!this.webhookUrl && this.enabled !== false;
  }

  /**
   * Post media to Discord via webhook using embeds
   * @param {Object} mediaData - The media data to post
   * @returns {Promise<boolean>} - Whether posting was successful
   */
  async postMedia(mediaData) {
    try {
      if (!this.isEnabled()) {
        console.log('Discord webhook not configured, skipping Discord post');
        return false;
      }

      console.log(`Preparing to send media to Discord webhook: ${mediaData.title}`);
      
      // Debug print what values we're working with
      console.log(`Source URL: ${mediaData.sourceUrl}`);
      console.log(`Source Image URL: ${mediaData.sourceImgUrl}`);
      console.log(`Is video: ${mediaData.isVideo}`);
      
      // Handle based on media type
      if (mediaData.isVideo) {
        // For videos, prioritize the thumbnail if available
        if (mediaData.sourceImgUrl) {
          console.log(`Using sourceImgUrl for video thumbnail: ${mediaData.sourceImgUrl}`);
          await this.sendVideoEmbed(mediaData);
        } else if (mediaData.originalImageUrl) {
          console.log(`Using originalImageUrl for video thumbnail: ${mediaData.originalImageUrl}`);
          mediaData.sourceImgUrl = mediaData.originalImageUrl;
          await this.sendVideoEmbed(mediaData);
        } else if (mediaData.imageUrl && await this.isLocalFile(mediaData.imageUrl)) {
          // Fall back to local file upload for the thumbnail
          console.log(`Using local thumbnail file: ${mediaData.imageUrl}`);
          await this.sendLocalFileEmbed(mediaData, mediaData.imageUrl, true);
        } else {
          await this.sendTextMessage(mediaData);
        }
        return true;
      }
      else if (mediaData.sourceImgUrl) {
        // Regular image with sourceImgUrl
        console.log(`Using sourceImgUrl for image embed: ${mediaData.sourceImgUrl}`);
        
        // Check if we should send multiple images
        if (mediaData.originalImageUrls && Array.isArray(mediaData.originalImageUrls) && mediaData.originalImageUrls.length > 1) {
          await this.sendMultipleImageEmbeds(mediaData);
        } else {
          await this.sendImageEmbed(mediaData);
        }
        return true;
      }
      else if (mediaData.originalImageUrl) {
        // Fallback to originalImageUrl if sourceImgUrl is not available
        console.log(`Using originalImageUrl for image embed: ${mediaData.originalImageUrl}`);
        mediaData.sourceImgUrl = mediaData.originalImageUrl;
        await this.sendImageEmbed(mediaData);
        return true;
      }
      else if (mediaData.imageUrl && await this.isLocalFile(mediaData.imageUrl)) {
        // Fall back to local file upload if we have a local file
        console.log(`Using local file for embed: ${mediaData.imageUrl}`);
        await this.sendLocalFileEmbed(mediaData, mediaData.imageUrl, false);
        return true;
      }
      else {
        // Fallback with just a text message if no media
        console.log('No suitable image URL found, sending text message');
        await this.sendTextMessage(mediaData);
        return true;
      }
    } catch (error) {
      console.error('Error posting to Discord webhook:', error);
      // Try with a simple text message if embed fails
      try {
        await this.sendTextMessage(mediaData);
      } catch (fallbackError) {
        console.error('Even fallback message failed:', fallbackError);
      }
      return false;
    }
  }

  /**
   * Create and send an image embed
   * @param {Object} mediaData - Media data with source and image URLs
   * @returns {Promise<void>}
   */
  async sendImageEmbed(mediaData) {
    // Ensure the URL is valid and HTTPS
    const imageUrl = this.validateImageUrl(mediaData.sourceImgUrl);
    if (!imageUrl) {
      console.warn(`Invalid image URL: ${mediaData.sourceImgUrl}, falling back to text message`);
      return this.sendTextMessage(mediaData);
    }
    
    console.log(`Sending embed with image URL: ${imageUrl}`);
    
    // Create a basic embed with the source image
    const embed = {
      title: mediaData.title || 'New post',
      url: mediaData.sourceUrl,
      color: this.getColorForSite(mediaData.siteName),
      image: {
        url: imageUrl
      },
      footer: {
        text: `Posted from ${mediaData.siteName}`
      },
      timestamp: mediaData.timestamp || new Date().toISOString()
    };
    
    // Add author name if available
    if (mediaData.name) {
      embed.author = {
        name: mediaData.name
      };
    }
    
    // Send the embed
    try {
      await axios.post(this.webhookUrl, {
        embeds: [embed]
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log('Successfully sent embed to Discord');
    } catch (error) {
      console.error('Error sending embed:', error.message);
      if (error.response) {
        console.error('Discord API response:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Create and send multiple image embeds if available
   * @param {Object} mediaData - Media data with source and image URLs
   * @returns {Promise<void>}
   */
  async sendMultipleImageEmbeds(mediaData) {
    // If we have multiple source image URLs
    if (mediaData.originalImageUrls && Array.isArray(mediaData.originalImageUrls) && mediaData.originalImageUrls.length > 1) {
      // Create embeds for each image (up to Discord's limit of 10)
      const embeds = [];
      const maxEmbeds = Math.min(mediaData.originalImageUrls.length, 10);
      
      for (let i = 0; i < maxEmbeds; i++) {
        const sourceImgUrl = this.validateImageUrl(mediaData.originalImageUrls[i]);
        if (!sourceImgUrl) {
          console.warn(`Skipping invalid image URL at index ${i}`);
          continue;
        }
        
        const embed = {
          title: i === 0 ? mediaData.title : null, // Only set title on first embed
          url: i === 0 ? mediaData.sourceUrl : null, // Only set URL on first embed
          color: this.getColorForSite(mediaData.siteName),
          image: {
            url: sourceImgUrl
          }
        };
        
        // Only add timestamp and footer to first embed
        if (i === 0) {
          embed.footer = {
            text: `Posted from ${mediaData.siteName}`
          };
          embed.timestamp = mediaData.timestamp || new Date().toISOString();
          
          // Add author name if available
          if (mediaData.name) {
            embed.author = {
              name: mediaData.name
            };
          }
        }
        
        embeds.push(embed);
      }
      
      if (embeds.length === 0) {
        // If all URLs were invalid, fall back to text message
        return this.sendTextMessage(mediaData);
      }
      
      // Send the embeds
      try {
        await axios.post(this.webhookUrl, {
          embeds: embeds
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log(`Successfully sent ${embeds.length} embeds to Discord`);
      } catch (error) {
        console.error('Error sending multiple embeds:', error.message);
        if (error.response) {
          console.error('Discord API response:', error.response.data);
        }
        throw error;
      }
    } else {
      // If we only have one image or no array, fall back to single image embed
      await this.sendImageEmbed(mediaData);
    }
  }
  
  /**
   * Create and send a video embed (using thumbnail image)
   * @param {Object} mediaData - Media data with source and video URLs
   * @returns {Promise<void>}
   */
  async sendVideoEmbed(mediaData) {
    // Ensure the URL is valid and HTTPS
    const imageUrl = this.validateImageUrl(mediaData.sourceImgUrl);
    if (!imageUrl) {
      console.warn(`Invalid thumbnail URL: ${mediaData.sourceImgUrl}, falling back to text message`);
      return this.sendTextMessage(mediaData);
    }
    
    console.log(`Sending video embed with thumbnail URL: ${imageUrl}`);
    
    // Create an embed with the source thumbnail image
    const embed = {
      title: mediaData.title || 'New video',
      url: mediaData.sourceUrl,
      color: this.getColorForSite(mediaData.siteName),
      image: {
        url: imageUrl
      },
      footer: {
        text: `Video from ${mediaData.siteName} (click to view)`
      },
      timestamp: mediaData.timestamp || new Date().toISOString()
    };
    
    // Add author name if available
    if (mediaData.name) {
      embed.author = {
        name: mediaData.name
      };
    }
    
    // Add a description noting this is a video
    embed.description = "This post contains a video. Click the title to watch.";
    
    // Send the embed
    try {
      await axios.post(this.webhookUrl, {
        embeds: [embed]
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log('Successfully sent video embed to Discord');
    } catch (error) {
      console.error('Error sending video embed:', error.message);
      if (error.response) {
        console.error('Discord API response:', error.response.data);
      }
      throw error;
    }
  }
  
  /**
   * Send a file upload with embed for cases where direct URLs don't work
   * @param {Object} mediaData - Media data
   * @param {string} filePath - Path to local file
   * @param {boolean} isVideo - Whether this is a video thumbnail
   * @returns {Promise<void>}
   */
  async sendLocalFileEmbed(mediaData, filePath, isVideo) {
    try {
      // First check if file exists
      await fs.access(filePath);
      
      // Create FormData for file upload
      const FormData = require('form-data');
      const form = new FormData();
      
      // Create embed
      const embed = {
        title: mediaData.title || (isVideo ? 'New video' : 'New post'),
        url: mediaData.sourceUrl,
        color: this.getColorForSite(mediaData.siteName),
        footer: {
          text: isVideo ? `Video from ${mediaData.siteName} (click to view)` : `Posted from ${mediaData.siteName}`
        },
        timestamp: mediaData.timestamp || new Date().toISOString()
      };
      
      if (isVideo) {
        embed.description = "This post contains a video. Click the title to watch.";
      }
      
      // Add author name if available
      if (mediaData.name) {
        embed.author = {
          name: mediaData.name
        };
      }
      
      // Add payload with embed
      form.append('payload_json', JSON.stringify({
        embeds: [embed]
      }));
      
      // Add file
      const fileName = path.basename(filePath);
      form.append('file', await fs.readFile(filePath), {
        filename: fileName,
        contentType: this.getContentTypeFromFileName(fileName)
      });
      
      // Send the form
      await axios.post(this.webhookUrl, form, {
        headers: form.getHeaders()
      });
      
      console.log(`Successfully sent local file embed with ${filePath}`);
    } catch (error) {
      console.error(`Error sending local file embed: ${error.message}`);
      // Fall back to text message
      await this.sendTextMessage(mediaData);
    }
  }
  
  /**
   * Send a simple text message when no media is available
   * @param {Object} mediaData - Media data with title and source URL
   * @returns {Promise<void>}
   */
  async sendTextMessage(mediaData) {
    await axios.post(this.webhookUrl, {
      content: `${mediaData.title || 'New post'} from ${mediaData.siteName}: ${mediaData.sourceUrl}`
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('Sent text-only message to Discord webhook');
  }
  
  /**
   * Check if a path is a valid local file
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} - Whether file exists
   */
  async isLocalFile(filePath) {
    try {
      if (!filePath) return false;
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Validate and sanitize image URL for Discord
   * @param {string} url - URL to validate
   * @returns {string|null} - Valid URL or null if invalid
   */
  validateImageUrl(url) {
    if (!url) return null;
    
    try {
      // Basic URL validation
      const urlObj = new URL(url);
      
      // Discord requires HTTPS URLs
      if (urlObj.protocol !== 'https:') {
        console.warn(`Discord requires HTTPS URLs, got: ${url}`);
        // Try to convert to HTTPS if it's HTTP
        if (urlObj.protocol === 'http:') {
          urlObj.protocol = 'https:';
          return urlObj.toString();
        }
        return null;
      }
      
      // Check for known problematic domains that don't work with Discord embeds
      const problematicDomains = [
        // Add domains that are known to block hotlinking or cause issues with Discord
      ];
      
      if (problematicDomains.some(domain => urlObj.hostname.includes(domain))) {
        console.warn(`Domain ${urlObj.hostname} may not work with Discord embeds`);
      }
      
      return url;
    } catch (error) {
      console.warn(`Invalid URL format: ${url}`, error.message);
      return null;
    }
  }
  
  /**
   * Get a color for the embed based on the site name
   * @param {string} siteName - The name of the site
   * @returns {number} - Discord color code
   */
  getColorForSite(siteName) {
    // Define colors for different sites
    const siteColors = {
      'FurAffinity': 0xFF7300, // Orange
      'e621': 0x00549E,       // Blue
      'SoFurry': 0x543E94,    // Purple
      'Weasyl': 0x990000,     // Red
      'Bluesky': 0x0085FF,    // Light blue
      'Twitter': 0x1DA1F2,    // Twitter blue
    };
    
    // Return the color for the site, or a default color if not found
    return siteColors[siteName] || 0x7289DA; // Default Discord blurple
  }
  
  /**
   * Get content type from file name
   * @param {string} fileName - File name
   * @returns {string} - Content type
   */
  getContentTypeFromFileName(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm'
    };
    
    return contentTypes[extension] || 'application/octet-stream';
  }
  
  /**
   * Shutdown the Discord webhook integration
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('Shutting down Discord webhook integration...');
    // No active connections to close
  }
}

module.exports = new DiscordWebhook();