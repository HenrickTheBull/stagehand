const axios = require('axios');
const { BskyAgent } = require('@atproto/api');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class BluskyScraper extends BaseScraper {
  constructor() {
    super();
    // Initialize with service endpoint only - no authentication needed for public posts
    this.serviceEndpoint = config.bluesky.service || 'https://bsky.social';
    // Fix the regex pattern syntax
    this.matcher = new RegExp('(?:https?://)?bsky\\.app/profile/(?<repo>\\S+)/post/(?<rkey>\\S+)');
  }

  canHandle(url) {
    const blueskyPattern = config.supportedSites.find(site => site.name === 'Bluesky').pattern;
    return blueskyPattern.test(url);
  }

  /**
   * Parse a Bluesky URL to extract handle and rkey (post ID)
   * @param {string} url - Bluesky URL
   * @returns {{repo: string, rkey: string}} - Extracted repo (handle) and rkey
   */
  parseBlueskyUrl(url) {
    try {
      const matches = this.matcher.exec(url);
      if (!matches || !matches.groups) {
        throw new Error('Invalid Bluesky URL format');
      }
      
      return {
        repo: matches.groups.repo,
        rkey: matches.groups.rkey
      };
    } catch (error) {
      throw new Error(`Failed to parse Bluesky URL: ${error.message}`);
    }
  }

  /**
   * Extract image from a Bluesky post that contains images
   * @param {string} url - The original URL
   * @param {string} did - The user's DID
   * @param {Object} record - The post record from AT Protocol
   * @returns {Promise<{imageUrl: string, sourceUrl: string, title: string}>} - Image data
   */
  async handleImages(url, did, record) {
    // Check if the post has images
    const images = record?.value?.embed?.images;
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images found in the post');
    }
    
    // Get the first image
    const image = images[0];
    
    if (!image?.image?.ref?.$link) {
      throw new Error('Invalid image reference in post');
    }
    
    // Construct the blob URL similar to the Rust implementation
    const blobUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${image.image.ref.$link}`;
    
    return {
      imageUrl: blobUrl,
      sourceUrl: url,
      title: record?.value?.text || `Post by ${did}`,
      siteName: 'Bluesky'
    };
  }

  /**
   * Extract video from a Bluesky post that contains a video
   * @param {string} url - The original URL
   * @param {string} did - The user's DID
   * @param {Object} record - The post record from AT Protocol
   * @returns {Promise<{imageUrl: string, sourceUrl: string, title: string}>} - Video data
   */
  async handleVideo(url, did, record) {
    // Check if the post has a video
    const video = record?.value?.embed?.video;
    if (!video || !video.ref || !video.ref.$link) {
      throw new Error('No video found in the post');
    }
    
    const cid = video.ref.$link;
    
    // Get the thumbnail image
    const thumbUrl = `https://video.bsky.app/watch/${did}/${cid}/thumbnail.jpg`;
    
    return {
      imageUrl: thumbUrl, // Using the thumbnail as our image
      sourceUrl: url,
      title: record?.value?.text || `Video by ${did}`,
      siteName: 'Bluesky'
    };
  }

  async extract(url) {
    try {
      // 1. Parse the URL to extract repo (handle) and rkey
      const { repo, rkey } = this.parseBlueskyUrl(url);
      
      // 2. Fetch the post record using public API (no auth needed)
      const recordUrl = new URL(`${this.serviceEndpoint}/xrpc/com.atproto.repo.getRecord`);
      recordUrl.searchParams.append('repo', repo);
      recordUrl.searchParams.append('collection', 'app.bsky.feed.post');
      recordUrl.searchParams.append('rkey', rkey);
      
      const response = await axios.get(recordUrl.toString(), {
        headers: {
          'User-Agent': 'Stagehand/1.0.0'
        }
      });
      
      const record = response.data;
      
      // Check if it's a post
      if (record?.value?.$type !== 'app.bsky.feed.post') {
        throw new Error('URL does not point to a Bluesky post');
      }
      
      // Extract the DID from the URI
      const uri = record.uri;
      const did = uri.split('/')[2];
      
      if (!did) {
        throw new Error('Could not extract DID from record URI');
      }
      
      // Handle different embed types
      switch (record?.value?.embed?.$type) {
        case 'app.bsky.embed.images':
          return await this.handleImages(url, did, record);
        case 'app.bsky.embed.video':
          return await this.handleVideo(url, did, record);
        default:
          throw new Error('Post does not contain any supported media (images or video)');
      }
    } catch (error) {
      console.error('Error extracting data from Bluesky:', error);
      throw new Error(`Failed to extract data from Bluesky: ${error.message}`);
    }
  }
}

module.exports = new BluskyScraper();