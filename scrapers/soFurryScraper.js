const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class SoFurryScraper extends BaseScraper {
  canHandle(url) {
    const soFurryPattern = config.supportedSites.find(site => site.name === 'SoFurry').pattern;
    return soFurryPattern.test(url);
  }

  async extract(url) {
    // Temporarily disabled - return message that it's coming soon
    return {
      error: "That's coming soon.",
      sourceUrl: url,
      siteName: 'SoFurry'
    };
    
    // Original implementation commented out
    /*
    try {
      // Use a common user agent to avoid being blocked
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      const response = await axios.get(url, { headers });
      const $ = cheerio.load(response.data);
      
      // Try to get OpenGraph data first
      let imageUrl = $('meta[property="og:image"]').attr('content');
      let title = $('meta[property="og:title"]').attr('content');
      
      // If not available, try other selectors
      if (!imageUrl) {
        imageUrl = $('#sfArtImage').attr('src') || $('#contentImageDiv img').attr('src');
      }
      
      if (!imageUrl) {
        throw new Error('Could not find image on SoFurry page');
      }
      
      // Get title if not found from og:title
      if (!title) {
        title = $('.sf-title').text().trim() || $('title').text().trim() || 'SoFurry Post';
      }
      
      // Get the artist
      const artist = $('.sf-username a').text().trim() || '';
      
      return {
        imageUrl: imageUrl.startsWith('http') ? imageUrl : `https://www.sofurry.com${imageUrl}`,
        sourceUrl: url,
        title: artist ? `${title} by ${artist}` : title,
        siteName: 'SoFurry'
      };
    } catch (error) {
      console.error('Error extracting data from SoFurry:', error);
      throw new Error(`Failed to extract data from SoFurry: ${error.message}`);
    }
    */
  }
}

module.exports = new SoFurryScraper();