const axios = require('axios');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class SoFurryScraper extends BaseScraper {
  canHandle(url) {
    const soFurryPattern = config.supportedSites.find(site => site.name === 'SoFurry').pattern;
    return soFurryPattern.test(url);
  }

  async extract(url) {
    try {
      // Extract submission ID from URL
      const submissionId = this.extractSubmissionId(url);
      if (!submissionId) {
        throw new Error('Could not extract submission ID from SoFurry URL');
      }

      // Call SoFurry API to get submission details
      const apiUrl = `https://api2.sofurry.com/std/getSubmissionDetails?id=${submissionId}&format=json`;
      const response = await axios.get(apiUrl);
      
      if (!response.data) {
        throw new Error('Failed to get data from SoFurry API');
      }

      // Get the content URL (full-sized image)
      const imageUrl = response.data.contentSourceUrl;
      
      // Check if this is a video
      const isVideo = this.isVideoUrl(imageUrl);
      
      // Format the submission title with author
      const title = response.data.title ? 
        `${response.data.title} by ${response.data.author}` : 
        `SoFurry submission by ${response.data.author}`;

      // Return the data in the format expected by baseScraper
      const result = {
        sourceUrl: url,
        title: title,
        siteName: 'SoFurry'
      };

      // Add either imageUrl or videoUrl depending on content type
      if (isVideo) {
        result.videoUrl = imageUrl;
        result.isVideo = true;
      } else {
        result.imageUrl = imageUrl;
      }

      return result;
    } catch (error) {
      console.error('Error extracting data from SoFurry:', error);
      throw new Error(`Failed to extract data from SoFurry: ${error.message}`);
    }
  }

  extractSubmissionId(url) {
    // Extract submission ID from various SoFurry URL formats
    // Example: https://www.sofurry.com/view/1234567 or https://sofurry.com/art/1234567
    const idMatches = url.match(/(?:view|art|submission)\/(\d+)/i);
    
    // If we found a match, return the first capture group (the ID)
    return idMatches ? idMatches[1] : null;
  }
}

module.exports = new SoFurryScraper();