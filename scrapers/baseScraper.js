/**
 * Base Scraper class that all scrapers should extend
 */
class BaseScraper {
  /**
   * Check if this scraper can handle the given URL
   * @param {string} url - The URL to check
   * @returns {boolean} - Whether this scraper can handle the URL
   */
  canHandle(url) {
    throw new Error('Method canHandle must be implemented by subclass');
  }

  /**
   * Extract media data from the given URL
   * @param {string} url - The URL to extract from
   * @returns {Promise<{imageUrl: string, videoUrl?: string, isVideo?: boolean, sourceUrl: string, title: string, siteName: string}>} - Extracted media data
   */
  async extract(url) {
    throw new Error('Method extract must be implemented by subclass');
  }

  /**
   * Determine if a URL points to a video resource
   * Common video extensions that should be detected
   * @param {string} url - URL to check
   * @returns {boolean} - Whether the URL is likely a video
   */
  isVideoUrl(url) {
    if (!url) return false;
    
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const urlLower = url.toLowerCase();
    
    // Check for video extensions
    return videoExtensions.some(ext => urlLower.endsWith(ext)) ||
           // Check for video in path segments
           urlLower.includes('/video/') ||
           // Check for video-specific patterns in various sites
           urlLower.includes('video.bsky.app');
  }
}

module.exports = BaseScraper;