const axios = require('axios');
const { BskyAgent } = require('@atproto/api');
const BaseScraper = require('./baseScraper');
const mediaCache = require('../utils/mediaCache');
const config = require('../config');

class BluskyScraper extends BaseScraper {
  constructor() {
    super();
    // Initialize with service endpoint only - no authentication needed for public posts
    this.serviceEndpoint = config.bluesky.service || 'https://bsky.social';
    // Fix the regex pattern syntax
    this.matcher = new RegExp('(?:https?://)?bsky\\.app/profile/(?<repo>\\S+)/post/(?<rkey>\\S+)');
    
    // Initialize the agent
    this.agent = new BskyAgent({ service: this.serviceEndpoint });
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
   * Get user's display name from their handle
   * @param {string} handle - The user's Bluesky handle
   * @returns {Promise<string>} - User's display name or handle if not found
   */
  async getUserDisplayName(handle) {
    try {
      // Try to get user info from API
      const response = await axios.get(`${this.serviceEndpoint}/xrpc/app.bsky.actor.getProfile`, {
        params: { actor: handle },
        headers: { 'User-Agent': 'Stagehand/1.1.0' }
      });
      
      if (response.data && response.data.displayName) {
        return response.data.displayName;
      }
      
      // Return handle if display name not found
      return handle;
    } catch (error) {
      console.log(`Couldn't get display name for ${handle}: ${error.message}`);
      return handle; // Fallback to handle on error
    }
  }

  /**
   * Fetch the post content directly from ATProto using the agent
   * @param {string} url - The original URL 
   * @returns {Promise<{imageUrl: string, videoUrl: string, isVideo: boolean, sourceUrl: string, title: string, siteName: string}>}
   */
  async extract(url) {
    try {
      // 1. Parse the URL to extract repo (handle) and rkey (post ID)
      const { repo, rkey } = this.parseBlueskyUrl(url);
      console.log(`Fetching Bluesky post: ${repo}/${rkey}`);
      
      // 2. Fetch the post record using ATProto API
      const recordUrl = new URL(`${this.serviceEndpoint}/xrpc/com.atproto.repo.getRecord`);
      recordUrl.searchParams.append('repo', repo);
      recordUrl.searchParams.append('collection', 'app.bsky.feed.post');
      recordUrl.searchParams.append('rkey', rkey);
      
      const response = await axios.get(recordUrl.toString(), {
        headers: {
          'User-Agent': 'Stagehand/1.1.0'
        }
      });
      
      const record = response.data;
      
      // 3. Check if it's a valid post
      if (record?.value?.$type !== 'app.bsky.feed.post') {
        throw new Error('URL does not point to a Bluesky post');
      }
      
      // 4. Extract the DID from the URI
      const uri = record.uri;
      const did = uri.split('/')[2];
      
      if (!did) {
        throw new Error('Could not extract DID from record URI');
      }

      // 5. Get user's display name
      const displayName = await this.getUserDisplayName(repo);
      console.log(`Using display name: ${displayName} for handle: ${repo}`);
      
      // 6. Process based on embed type
      const embedType = record?.value?.embed?.$type;
      console.log(`Post has embed type: ${embedType}`);
      
      // 7. Handle image posts
      if (embedType === 'app.bsky.embed.images') {
        const images = record?.value?.embed?.images;
        if (!images || !Array.isArray(images) || images.length === 0) {
          throw new Error('No images found in the post');
        }
        
        // Get the first image
        const image = images[0];
        
        if (!image?.image?.ref?.$link) {
          throw new Error('Invalid image reference in post');
        }
        
        const cid = image.image.ref.$link;
        console.log(`Processing image with CID: ${cid}`);
        
        // Direct blob URL is most reliable
        const blobUrl = `${this.serviceEndpoint}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;
        
        // Process and cache the image
        const processed = await mediaCache.processMediaUrl(blobUrl);
        
        return {
          imageUrl: processed.localPath,
          sourceUrl: url,
          title: `Bluesky Image by ${displayName}`,
          siteName: 'Bluesky',
          isVideo: false
        };
      }
      
      // 8. Handle video posts
      else if (embedType === 'app.bsky.embed.video') {
        const video = record?.value?.embed?.video;
        if (!video || !video.ref || !video.ref.$link) {
          throw new Error('No video found in the post');
        }
        
        const cid = video.ref.$link;
        console.log(`Processing video with CID: ${cid}`);
        
        const aspectRatio = record?.value?.embed?.aspectRatio || { width: 0, height: 0 };
        console.log(`Video aspect ratio: ${aspectRatio.width}x${aspectRatio.height}`);
        
        try {
          // First, get the thumbnail image
          const thumbUrl = `https://video.bsky.app/watch/${did}/${cid}/thumbnail.jpg`;
          const thumbnailProcessed = await mediaCache.processMediaUrl(thumbUrl);
          
          // Direct blob access is most reliable for video
          const videoBlobUrl = `${this.serviceEndpoint}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;
          let videoProcessed = null;
          
          try {
            console.log(`Downloading video from blob URL: ${videoBlobUrl}`);
            videoProcessed = await mediaCache.processMediaUrl(videoBlobUrl, true);
            
            return {
              imageUrl: thumbnailProcessed.localPath, // Thumbnail for preview
              videoUrl: videoProcessed.localPath, // Cached and transcoded video
              isVideo: true,
              sourceUrl: url,
              title: `Bluesky Video by ${displayName}`,
              siteName: 'Bluesky'
            };
          } catch (blobError) {
            console.error(`Failed to download video from blob URL: ${blobError.message}`);
            
            // If direct blob access fails, try alternative URLs
            const videoUrls = [
              `https://video.bsky.app/watch/${did}/${cid}/video.mp4`,
              `https://video.bsky.app/watch/${did}/${cid}/480.mp4`,
              `https://video.bsky.app/watch/${did}/${cid}/720.mp4`,
              `https://video.bsky.app/watch/${did}/${cid}/1080.mp4`,
              `https://video.bsky.app/watch/${did}/${cid}/${cid}.mp4`
            ];
            
            for (const videoUrl of videoUrls) {
              try {
                console.log(`Trying alternative video URL: ${videoUrl}`);
                videoProcessed = await mediaCache.processMediaUrl(videoUrl, true);
                console.log(`Successfully downloaded video from: ${videoUrl}`);
                break;
              } catch (e) {
                console.log(`Failed with URL ${videoUrl}: ${e.message}`);
              }
            }
            
            if (videoProcessed) {
              return {
                imageUrl: thumbnailProcessed.localPath,
                videoUrl: videoProcessed.localPath,
                isVideo: true,
                sourceUrl: url,
                title: `Bluesky Video by ${displayName}`,
                siteName: 'Bluesky'
              };
            }
          }
          
          // If all video attempts fail, fall back to thumbnail only
          console.warn('Could not download Bluesky video, using thumbnail only');
          return {
            imageUrl: thumbnailProcessed.localPath,
            sourceUrl: url,
            title: `Bluesky Video by ${displayName}`,
            siteName: 'Bluesky',
            isVideo: false
          };
        } catch (error) {
          console.error('Error processing Bluesky video:', error);
          throw new Error(`Could not process Bluesky video: ${error.message}`);
        }
      } 
      
      // 9. Handle unsupported embed types
      else {
        throw new Error('Post does not contain any supported media (images or video)');
      }
    } catch (error) {
      console.error('Error extracting data from Bluesky:', error);
      throw new Error(`Failed to extract data from Bluesky: ${error.message}`);
    }
  }
}

module.exports = new BluskyScraper();