const axios = require('axios');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class FurAffinityScraper extends BaseScraper {
  canHandle(url) {
    const faPattern = config.supportedSites.find(site => site.name === 'FurAffinity').pattern;
    return faPattern.test(url);
  }

  async extract(url) {
    try {
      // Extract the ID from the URL
      // URL format: https://www.furaffinity.net/view/58260087
      const match = url.match(/\/view\/(\d+)/);
      if (!match || !match[1]) {
        throw new Error('Could not extract submission ID from FurAffinity URL');
      }
      
      const submissionId = match[1];
      
      // Use the FA Export API to get submission data
      const apiUrl = `https://faexport.spangle.org.uk/submission/${submissionId}.json`;
      
      // Set a common user agent to avoid being blocked
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };
      
      const response = await axios.get(apiUrl, { headers });
      const data = response.data;
      
      if (!data || !data.download) {
        throw new Error('Could not find download URL in the API response');
      }
      
      const imageUrl = data.download;
      const title = data.title || 'FurAffinity Post';
      const artist = data.name || '';
      const isVideo = this.isVideoUrl(imageUrl);
      
      return {
        imageUrl: isVideo ? undefined : imageUrl,
        videoUrl: isVideo ? imageUrl : undefined,
        isVideo: isVideo,
        sourceUrl: url,
        title: artist ? `${title}` : title,
        name: artist, // Add the name field explicitly
        siteName: 'FurAffinity'
      };
    } catch (error) {
      console.error('Error extracting data from FurAffinity:', error);
      throw new Error(`Failed to extract data from FurAffinity: ${error.message}`);
    }
  }
}

module.exports = new FurAffinityScraper();