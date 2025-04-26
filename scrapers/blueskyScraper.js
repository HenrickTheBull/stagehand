const axios = require('axios');
const { BskyAgent } = require('@atproto/api');
const BaseScraper = require('./baseScraper');
const mediaCache = require('../utils/mediaCache');
const config = require('../config');
const path = require('path'); 
const crypto = require('crypto-js'); // Add crypto-js for hashing

class BluskyScraper extends BaseScraper {
  constructor() {
    super();
    // Initialize with service endpoint only - no authentication needed for public posts
    this.serviceEndpoint = config.bluesky.service || 'https://bsky.social';
    // Update regex to support both bsky.app and deer.social
    this.matcher = new RegExp('(?:https?://)?(?:bsky\\.app|deer\\.social)/profile/(?<repo>\\S+)/post/(?<rkey>\\S+)');
    
    // Initialize the agent
    this.agent = new BskyAgent({ service: this.serviceEndpoint });
  }

  canHandle(url) {
    // Check all Bluesky-related patterns from config
    const blueskyPatterns = config.supportedSites
      .filter(site => site.name === 'Bluesky')
      .map(site => site.pattern);
    
    // Return true if any pattern matches
    return blueskyPatterns.some(pattern => pattern.test(url));
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
   * Process an image from Bluesky using its CID
   * @param {string} did - The user's DID
   * @param {string} cid - The content ID of the image
   * @returns {Promise<string>} - The local path to the cached image
   */
  async processImageByCid(did, cid) {
    console.log(`Processing image with CID: ${cid}`);
    
    // Direct blob URL is most reliable
    const blobUrl = `${this.serviceEndpoint}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`;
    
    try {
      // Download the blob directly to avoid filename issues
      const response = await axios({
        method: 'GET',
        url: blobUrl,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Stagehand/1.1.0'
        }
      });
      
      // Get the content type to determine file extension
      const contentType = response.headers['content-type'];
      let fileExt = '.jpg'; // Default extension
      
      if (contentType) {
        if (contentType.includes('png')) {
          fileExt = '.png';
        } else if (contentType.includes('gif')) {
          fileExt = '.gif';
        } else if (contentType.includes('webp')) {
          fileExt = '.webp';
        }
      }
      
      // Convert binary data to base64 for hashing
      const base64Data = Buffer.from(response.data).toString('base64');
      
      // Generate MD5 hash of the image data
      const hash = crypto.MD5(base64Data).toString();
      
      // Create filename from the hash
      const filename = `${hash}${fileExt}`;
      const filePath = path.join(mediaCache.imageDir, filename);
      
      console.log(`Saving image as ${filename}`);
      
      // Save the image to disk
      await require('fs-extra').writeFile(filePath, response.data);
      
      return filePath;
    } catch (error) {
      console.error(`Error downloading blob for CID ${cid}: ${error.message}`);
      
      // Fall back to mediaCache if direct download fails
      // Process and cache the image using mediaCache method
      try {
        const processed = await mediaCache.processMediaUrl(`https://cdn.bsky.app/img/feed/plain/${did}/${cid}@jpeg`);
        return processed.localPath;
      } catch (fallbackError) {
        console.error(`Fallback download also failed for CID ${cid}: ${fallbackError.message}`);
        throw fallbackError;
      }
    }
  }

  /**
   * Process all images from a Bluesky embed
   * @param {object} images - The images array from the embed
   * @param {string} did - The user's DID 
   * @returns {Promise<Array<string>>} - Array of local paths to the cached images
   */
  async processAllImages(images, did) {
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images found in the content');
    }

    const imagePaths = [];
    
    // Process all images in the array
    for (const image of images) {
      if (!image?.image?.ref?.$link) {
        console.warn('Skipping invalid image reference in post');
        continue;
      }
      
      const cid = image.image.ref.$link;
      try {
        const localPath = await this.processImageByCid(did, cid);
        imagePaths.push(localPath);
      } catch (error) {
        console.error(`Failed to process image with CID ${cid}: ${error.message}`);
      }
    }

    if (imagePaths.length === 0) {
      throw new Error('Failed to process any images from the post');
    }
    
    return imagePaths;
  }

  /**
   * Fetch a quoted post by its URI
   * @param {string} uri - The quoted post URI
   * @param {string} cid - The quoted post CID
   * @returns {Promise<object>} - The quoted post data
   */
  async fetchQuotedPost(uri, cid) {
    try {
      const response = await this.agent.api.app.bsky.feed.getPosts({ uris: [uri] });
      if (response && response.data && response.data.posts && response.data.posts.length > 0) {
        return response.data.posts[0];
      }
      throw new Error('Quoted post not found in response');
    } catch (error) {
      console.error(`Failed to fetch quoted post: ${error.message}`);
      
      // Fallback to direct repository lookup if agent API fails
      try {
        // Parse URI to get components
        const uriParts = uri.split('/');
        if (uriParts.length < 4) throw new Error('Invalid post URI format');
        
        const did = uriParts[2];
        const collection = uriParts[3]; 
        const rkey = uriParts[4];
        
        // Fetch using repo API
        const recordUrl = new URL(`${this.serviceEndpoint}/xrpc/com.atproto.repo.getRecord`);
        recordUrl.searchParams.append('repo', did);
        recordUrl.searchParams.append('collection', collection);
        recordUrl.searchParams.append('rkey', rkey);
        
        const response = await axios.get(recordUrl.toString(), {
          headers: { 'User-Agent': 'Stagehand/1.1.0' }
        });
        
        return {
          uri: uri,
          cid: cid,
          ...response.data.value
        };
      } catch (fallbackError) {
        console.error(`Fallback fetch also failed: ${fallbackError.message}`);
        throw new Error(`Could not fetch quoted post: ${error.message}`);
      }
    }
  }

  /**
   * Process images from a recordWithMedia embed (post with quoted content)
   * @param {object} embed - The recordWithMedia embed object
   * @param {string} did - The user's DID
   * @returns {Promise<Array<string>>} - Array of local paths to the cached images
   */
  async processRecordWithMedia(embed, did) {
    const imagePaths = [];
    
    // Only process media in the main post, ignore quoted content
    if (embed.media && embed.media.$type === 'app.bsky.embed.images') {
      const mediaImages = await this.processAllImages(embed.media.images, did);
      imagePaths.push(...mediaImages);
    }
    
    return imagePaths;
  }

  /**
   * Fetch the post content directly from ATProto using the agent
   * @param {string} url - The original URL 
   * @returns {Promise<{imageUrl: string, imageUrls: Array<string>, videoUrl: string, isVideo: boolean, sourceUrl: string, title: string, siteName: string}>}
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
      console.log(`Post has embed type: ${embedType || 'none'}`);
      
      // 7. Handle image posts
      if (embedType === 'app.bsky.embed.images') {
        const imagePaths = await this.processAllImages(record.value.embed.images, did);
        
        // Get source image URLs for each image
        const sourceImageUrls = [];
        if (record.value.embed.images && Array.isArray(record.value.embed.images)) {
          for (const image of record.value.embed.images) {
            if (image?.image?.ref?.$link) {
              const cid = image.image.ref.$link;
              const sourceUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@jpeg`;
              sourceImageUrls.push(sourceUrl);
            }
          }
        }
        
        return {
          imageUrl: imagePaths[0], // First image as primary
          imageUrls: imagePaths, // All images
          sourceUrl: url,
          title: `Bluesky Image${imagePaths.length > 1 ? 's' : ''} by ${displayName}`,
          siteName: 'Bluesky',
          isVideo: false,
          originalImageUrl: sourceImageUrls[0], // First original URL
          originalImageUrls: sourceImageUrls, // All original URLs
          sourceImgUrl: sourceImageUrls[0] // Add the new sourceImgUrl field
        };
      }
      
      // 8. Handle posts with quoted content and media
      else if (embedType === 'app.bsky.embed.recordWithMedia') {
        const imagePaths = await this.processRecordWithMedia(record.value.embed, did);
        
        // Get source image URLs from recordWithMedia
        const sourceImageUrls = [];
        if (record.value.embed.media && 
            record.value.embed.media.$type === 'app.bsky.embed.images' && 
            record.value.embed.media.images && 
            Array.isArray(record.value.embed.media.images)) {
          
          for (const image of record.value.embed.media.images) {
            if (image?.image?.ref?.$link) {
              const cid = image.image.ref.$link;
              const sourceUrl = `https://cdn.bsky.app/img/feed/plain/${did}/${cid}@jpeg`;
              sourceImageUrls.push(sourceUrl);
            }
          }
        }
        
        return {
          imageUrl: imagePaths[0], // First image as primary
          imageUrls: imagePaths, // All images
          sourceUrl: url,
          title: `Bluesky Image${imagePaths.length > 1 ? 's' : ''} by ${displayName}`,
          siteName: 'Bluesky',
          isVideo: false,
          originalImageUrl: sourceImageUrls[0], // First original URL
          originalImageUrls: sourceImageUrls, // All original URLs
          sourceImgUrl: sourceImageUrls[0] // Add the new sourceImgUrl field
        };
      }
      
      // 9. Handle video posts
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
          let sourceVideoUrl = `https://video.bsky.app/watch/${did}/${cid}/video.mp4`;
          
          try {
            console.log(`Downloading video from blob URL: ${videoBlobUrl}`);
            videoProcessed = await mediaCache.processMediaUrl(videoBlobUrl, true);
            sourceVideoUrl = videoBlobUrl;
            
            return {
              imageUrl: thumbnailProcessed.localPath, // Thumbnail for preview
              imageUrls: [thumbnailProcessed.localPath], // Single thumbnail
              videoUrl: videoProcessed.localPath, // Cached and transcoded video
              isVideo: true,
              sourceUrl: url,
              title: `Bluesky Video by ${displayName}`,
              siteName: 'Bluesky',
              originalImageUrl: thumbUrl,
              originalVideoUrl: sourceVideoUrl,
              sourceImgUrl: thumbUrl, // Use thumbnail URL as sourceImgUrl for videos
              sourceVideoUrl: sourceVideoUrl // Additional field for video source
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
                sourceVideoUrl = videoUrl;
                break;
              } catch (e) {
                console.log(`Failed with URL ${videoUrl}: ${e.message}`);
              }
            }
            
            if (videoProcessed) {
              return {
                imageUrl: thumbnailProcessed.localPath,
                imageUrls: [thumbnailProcessed.localPath], // Single thumbnail
                videoUrl: videoProcessed.localPath,
                isVideo: true,
                sourceUrl: url,
                title: `Bluesky Video by ${displayName}`,
                siteName: 'Bluesky',
                originalImageUrl: thumbUrl,
                originalVideoUrl: sourceVideoUrl,
                sourceImgUrl: thumbUrl, // Use thumbnail URL as sourceImgUrl for videos
                sourceVideoUrl: sourceVideoUrl // Additional field for video source
              };
            }
          }
          
          // If all video attempts fail, fall back to thumbnail only
          console.warn('Could not download Bluesky video, using thumbnail only');
          return {
            imageUrl: thumbnailProcessed.localPath,
            imageUrls: [thumbnailProcessed.localPath], // Single thumbnail
            sourceUrl: url,
            title: `Bluesky Video by ${displayName}`,
            siteName: 'Bluesky',
            isVideo: false,
            originalImageUrl: thumbUrl,
            sourceImgUrl: thumbUrl // Add the new sourceImgUrl field
          };
        } catch (error) {
          console.error('Error processing Bluesky video:', error);
          throw new Error(`Could not process Bluesky video: ${error.message}`);
        }
      } 
      
      // 10. Handle unsupported embed types
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