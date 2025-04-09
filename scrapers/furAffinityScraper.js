const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class FurAffinityScraper extends BaseScraper {
  canHandle(url) {
    const faPattern = config.supportedSites.find(site => site.name === 'FurAffinity').pattern;
    return faPattern.test(url);
  }

  async extract(url) {
    // Temporarily disabled - return message that it's coming soon
    return {
      error: "That's coming soon.",
      sourceUrl: url,
      siteName: 'FurAffinity'
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
      
      // FurAffinity's main image is usually in the main-view section
      const imageUrl = $('#submissionImg').attr('src') || $('.classic-submission-stage img').attr('src');
      
      if (!imageUrl) {
        throw new Error('Could not find image on FurAffinity page');
      }
      
      // Get the title
      const title = $('.submission-title').text().trim() || $('title').text().trim() || 'FurAffinity Post';
      
      // Get the artist
      const artist = $('.submission-id-sub-container a strong').text().trim() || $('.classic-submission-title a').text().trim() || '';
      
      return {
        imageUrl: imageUrl.startsWith('http') ? imageUrl : `https:${imageUrl}`,
        sourceUrl: url,
        title: artist ? `${title} by ${artist}` : title,
        siteName: 'FurAffinity'
      };
    } catch (error) {
      console.error('Error extracting data from FurAffinity:', error);
      throw new Error(`Failed to extract data from FurAffinity: ${error.message}`);
    }
    */
  }
}

module.exports = new FurAffinityScraper();