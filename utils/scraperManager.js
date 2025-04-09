const e621Scraper = require('../scrapers/e621Scraper');
const furAffinityScraper = require('../scrapers/furAffinityScraper');
const soFurryScraper = require('../scrapers/soFurryScraper');
const weasylScraper = require('../scrapers/weasylScraper');
const blueskyScraper = require('../scrapers/blueskyScraper');

class ScraperManager {
  constructor() {
    this.scrapers = [
      e621Scraper,
      furAffinityScraper,
      soFurryScraper,
      weasylScraper,
      blueskyScraper
    ];
  }

  /**
   * Find the appropriate scraper for a given URL
   * @param {string} url - The URL to find a scraper for
   * @returns {BaseScraper|null} - The scraper that can handle the URL, or null if none found
   */
  findScraper(url) {
    return this.scrapers.find(scraper => scraper.canHandle(url)) || null;
  }

  /**
   * Extract image data from a URL using the appropriate scraper
   * @param {string} url - The URL to extract from
   * @returns {Promise<{imageUrl: string, sourceUrl: string, title: string, siteName: string}>} - Extracted image data
   */
  async extractFromUrl(url) {
    const scraper = this.findScraper(url);
    
    if (!scraper) {
      throw new Error(`No suitable scraper found for URL: ${url}`);
    }
    
    return await scraper.extract(url);
  }
}

module.exports = new ScraperManager();