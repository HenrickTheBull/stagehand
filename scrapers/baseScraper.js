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
   * Extract image data from the given URL
   * @param {string} url - The URL to extract from
   * @returns {Promise<{imageUrl: string, sourceUrl: string, title: string}>} - Extracted image data
   */
  async extract(url) {
    throw new Error('Method extract must be implemented by subclass');
  }
}

module.exports = BaseScraper;