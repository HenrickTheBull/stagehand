const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class WeasylScraper extends BaseScraper {
  canHandle(url) {
    // This is for the site you called "Weasly", but I'm assuming it's "Weasyl"
    // Update config.js if needed to match the correct domain
    const weasylPattern = config.supportedSites.find(site => site.name === 'Weasly').pattern;
    return weasylPattern.test(url);
  }

  async extract(url) {
    // Temporarily disabled - return message that it's coming soon
    return {
      error: "That's coming soon.",
      sourceUrl: url,
      siteName: 'Weasyl'
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
      
      // Try to get the main image
      const imageUrl = $('.content-submission-image').attr('src') || $('img.image').attr('src');
      
      if (!imageUrl) {
        throw new Error('Could not find image on Weasyl page');
      }
      
      // Get the title
      const title = $('.info h2').text().trim() || $('title').text().trim() || 'Weasyl Post';
      
      // Get the artist
      const artist = $('.username').text().trim() || '';
      
      return {
        imageUrl: imageUrl.startsWith('http') ? imageUrl : `https://www.weasyl.com${imageUrl}`,
        sourceUrl: url,
        title: artist ? `${title} by ${artist}` : title,
        siteName: 'Weasyl'
      };
    } catch (error) {
      console.error('Error extracting data from Weasyl:', error);
      throw new Error(`Failed to extract data from Weasyl: ${error.message}`);
    }
    */
  }
}

module.exports = new WeasylScraper();