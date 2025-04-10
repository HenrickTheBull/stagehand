// filepath: /home/hstafford/programming/stagehand/utils/mediaCache.js
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto-js');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const config = require('../config');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

class MediaCache {
  constructor() {
    // Set up cache directory structure
    this.cacheDirBase = config.cacheDir || path.join(__dirname, '..', 'cache');
    this.imageDir = path.join(this.cacheDirBase, 'images');
    this.videoDir = path.join(this.cacheDirBase, 'videos');
    this.transcodedDir = path.join(this.cacheDirBase, 'transcoded');
    
    // Maximum cache age in days (15 days by default)
    this.maxCacheAgeDays = config.maxCacheAgeDays || 15;
    
    // Initialize cache directories
    this.initCacheDirs();
    
    // Schedule cache cleanup
    this.scheduleCacheCleanup();
  }

  /**
   * Initialize cache directories
   */
  async initCacheDirs() {
    try {
      await fs.ensureDir(this.cacheDirBase);
      await fs.ensureDir(this.imageDir);
      await fs.ensureDir(this.videoDir);
      await fs.ensureDir(this.transcodedDir);
      console.log('Cache directories initialized');
    } catch (error) {
      console.error('Error initializing cache directories:', error);
    }
  }

  /**
   * Schedule periodic cache cleanup
   */
  scheduleCacheCleanup() {
    // Run cache cleanup once a day
    const oneDayMs = 24 * 60 * 60 * 1000;
    setInterval(() => {
      this.cleanupCache().catch(err => {
        console.error('Error during cache cleanup:', err);
      });
    }, oneDayMs);
    
    // Also run cleanup on startup
    this.cleanupCache().catch(err => {
      console.error('Error during initial cache cleanup:', err);
    });
  }

  /**
   * Clean up old cache files
   */
  async cleanupCache() {
    console.log('Starting cache cleanup...');
    const now = Date.now();
    const maxAgeMs = this.maxCacheAgeDays * 24 * 60 * 60 * 1000;
    
    // Helper function to clean a specific directory
    const cleanDir = async (dir) => {
      try {
        const files = await fs.readdir(dir);
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stats = await fs.stat(filePath);
          
          // Check if file is older than max cache age
          if (now - stats.mtimeMs > maxAgeMs) {
            await fs.remove(filePath);
            console.log(`Removed old cache file: ${file}`);
          }
        }
      } catch (error) {
        console.error(`Error cleaning directory ${dir}:`, error);
      }
    };
    
    // Clean all cache directories
    await cleanDir(this.imageDir);
    await cleanDir(this.videoDir);
    await cleanDir(this.transcodedDir);
    
    console.log('Cache cleanup completed');
  }

  /**
   * Generate a hash from URL to use as filename
   * @param {string} url - URL to hash
   * @returns {string} - Hashed filename
   */
  getHashedFilename(url) {
    return crypto.MD5(url).toString();
  }

  /**
   * Check if a file exists in cache and is not expired
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} - Whether file exists and is valid
   */
  async isValidCacheFile(filePath) {
    try {
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        return false;
      }
      
      // Check if file is not too old
      const stats = await fs.stat(filePath);
      const ageMs = Date.now() - stats.mtimeMs;
      const maxAgeMs = this.maxCacheAgeDays * 24 * 60 * 60 * 1000;
      
      return ageMs <= maxAgeMs;
    } catch (error) {
      console.error('Error checking cache file validity:', error);
      return false;
    }
  }

  /**
   * Get file extension from URL or content type
   * @param {string} url - URL to extract extension from
   * @param {string} contentType - Content-Type header
   * @returns {string} - File extension
   */
  getFileExtension(url, contentType) {
    // Try to get extension from URL first
    const urlExt = path.extname(url).toLowerCase();
    if (urlExt && urlExt.length > 1) {
      return urlExt;
    }
    
    // If not found, try to determine from content type
    if (contentType) {
      switch (contentType.toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
          return '.jpg';
        case 'image/png':
          return '.png';
        case 'image/gif':
          return '.gif';
        case 'image/webp':
          return '.webp';
        case 'video/mp4':
          return '.mp4';
        case 'video/webm':
          return '.webm';
        default:
          // Default extension based on content type category
          if (contentType.startsWith('image/')) {
            return '.jpg';
          } else if (contentType.startsWith('video/')) {
            return '.mp4';
          }
      }
    }
    
    // Default extension
    return '.bin';
  }

  /**
   * Check if a URL points to a video based on URL or content type
   * @param {string} url - URL to check
   * @param {string} contentType - Content-Type header
   * @returns {boolean} - Whether URL is likely a video
   */
  isVideoUrl(url, contentType) {
    // Check URL extension first
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const urlExt = path.extname(url).toLowerCase();
    if (videoExtensions.includes(urlExt)) {
      return true;
    }
    
    // Check content type
    if (contentType && contentType.toLowerCase().startsWith('video/')) {
      return true;
    }
    
    // Check URL for video-specific patterns
    const videoPatterns = [
      /\/video\//i,
      /\.mp4/i,
      /\.webm/i,
      /bluesky.*video/i
    ];
    
    return videoPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Download media (image or video) and cache it
   * @param {string} url - URL to download
   * @param {boolean} isVideo - Whether URL is known to be a video
   * @returns {Promise<{filePath: string, contentType: string, isVideo: boolean}>} - Path to cached file
   */
  async downloadMedia(url, isVideo = false) {
    try {
      let contentType = null;
      
      // Special handling for Bluesky URLs
      const isBlueskyUrl = url.includes('bsky.social') || url.includes('video.bsky.app');
      
      if (!isBlueskyUrl) {
        // For non-Bluesky URLs, use HEAD request to get content type
        try {
          const headResponse = await axios.head(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 Stagehand/1.1.0'
            },
            timeout: 10000
          });
          contentType = headResponse.headers['content-type'];
        } catch (headError) {
          console.log(`HEAD request failed for ${url}, falling back to GET: ${headError.message}`);
          // If HEAD fails, we'll proceed without content type info
        }
      } else {
        // For Bluesky URLs, determine content type based on URL pattern
        console.log('Detected Bluesky URL, skipping HEAD request');
        if (url.includes('video.bsky.app')) {
          contentType = 'video/mp4';
          isVideo = true;
        } else if (url.includes('getBlob')) {
          contentType = 'image/jpeg'; // Default assumption for Bluesky blobs
        }
      }
      
      // Determine if it's a video if not explicitly known
      if (!isVideo) {
        isVideo = this.isVideoUrl(url, contentType);
      }
      
      // Generate unique filename
      const hash = this.getHashedFilename(url);
      const ext = this.getFileExtension(url, contentType);
      const filename = `${hash}${ext}`;
      
      // Determine storage directory and full path
      const storageDir = isVideo ? this.videoDir : this.imageDir;
      const filePath = path.join(storageDir, filename);
      
      // Check if already cached and valid
      if (await this.isValidCacheFile(filePath)) {
        console.log(`Using cached ${isVideo ? 'video' : 'image'}: ${filename}`);
        return { filePath, contentType, isVideo };
      }
      
      // Download the file
      console.log(`Downloading ${isVideo ? 'video' : 'image'} from ${url}`);
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 Stagehand/1.1.0',
          'Accept': '*/*'
        },
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024 // 50MB max
      });
      
      // Update content type if we get it from the GET response
      if (!contentType && response.headers['content-type']) {
        contentType = response.headers['content-type'];
      }
      
      // Save to cache
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          resolve({ filePath, contentType, isVideo });
        });
        writer.on('error', reject);
      });
    } catch (error) {
      console.error(`Error downloading media from ${url}:`, error);
      throw new Error(`Failed to download media: ${error.message}`);
    }
  }

  /**
   * Transcode video to H.264 MP4 format
   * @param {string} inputPath - Path to input video
   * @returns {Promise<string>} - Path to transcoded video
   */
  async transcodeVideo(inputPath) {
    try {
      // Generate output path
      const inputFilename = path.basename(inputPath);
      const outputFilename = `${path.parse(inputFilename).name}.mp4`;
      const outputPath = path.join(this.transcodedDir, outputFilename);
      
      // Check if already transcoded and valid
      if (await this.isValidCacheFile(outputPath)) {
        console.log(`Using cached transcoded video: ${outputFilename}`);
        return outputPath;
      }
      
      console.log(`Transcoding video: ${inputFilename}`);
      
      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-c:v libx264',
            '-crf 23',
            '-preset medium',
            '-c:a aac',
            '-b:a 128k',
            '-movflags +faststart',
            '-pix_fmt yuv420p'
          ])
          .output(outputPath)
          .on('end', () => {
            console.log(`Video transcoding completed: ${outputFilename}`);
            resolve(outputPath);
          })
          .on('error', (err) => {
            console.error('Error transcoding video:', err);
            reject(new Error(`Transcoding failed: ${err.message}`));
          })
          .run();
      });
    } catch (error) {
      console.error('Error in transcodeVideo:', error);
      throw new Error(`Failed to transcode video: ${error.message}`);
    }
  }

  /**
   * Process a media URL - download, cache, and transcode if needed
   * @param {string} url - Media URL to process
   * @param {boolean} isVideo - Whether URL is known to be a video
   * @returns {Promise<{localPath: string, isVideo: boolean, contentType: string}>} - Processed media info
   */
  async processMediaUrl(url, isVideo = false) {
    // Download and cache the media
    const { filePath, contentType, isVideo: detectedVideo } = await this.downloadMedia(url, isVideo);
    
    // If it's a video, transcode it
    if (detectedVideo) {
      const transcodedPath = await this.transcodeVideo(filePath);
      return { localPath: transcodedPath, isVideo: true, contentType };
    }
    
    // For images, just return the cached path
    return { localPath: filePath, isVideo: false, contentType };
  }

  /**
   * Clean up cache on shutdown
   */
  async shutdown() {
    console.log('MediaCache shutting down...');
    // Perform any necessary cleanup
  }
}

module.exports = new MediaCache();