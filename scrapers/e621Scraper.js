const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class E621Scraper extends BaseScraper {
  canHandle(url) {
    const e621Pattern = config.supportedSites.find(site => site.name === 'e621').pattern;
    return e621Pattern.test(url);
  }

  async extract(url) {
    try {
      // Use a common user agent to avoid being blocked
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      const response = await axios.get(url, { headers });
      const $ = cheerio.load(response.data);
      
      // Extract OpenGraph data
      const ogImage = $('meta[property="og:image"]').attr('content');
      const ogTitle = $('meta[property="og:title"]').attr('content');
      const ogUrl = $('meta[property="og:url"]').attr('content') || url;

      // If we couldn't get the OpenGraph image, fallback to other methods
      if (!ogImage) {
        // Try to find the image in the post content
        const imageUrl = $('#image').attr('src') || $('.preview-container img').attr('src');
        if (!imageUrl) {
          throw new Error('Could not find image on e621 page');
        }
        
        return {
          imageUrl,
          sourceUrl: url,
          title: $('.post-info h1').text() || 'e621 Post'
        };
      }

      return {
        imageUrl: ogImage,
        sourceUrl: ogUrl,
        title: ogTitle || 'e621 Post',
        siteName: 'e621'
      };
    } catch (error) {
      console.error('Error extracting data from e621:', error);
      throw new Error(`Failed to extract data from e621: ${error.message}`);
    }
  }
}

module.exports = new E621Scraper();