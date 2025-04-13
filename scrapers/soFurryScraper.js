const axios = require('axios');
const BaseScraper = require('./baseScraper');
const mediaCache = require('../utils/mediaCache');
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
      const sourceImageUrl = response.data.contentSourceUrl;
      if (!sourceImageUrl) {
        throw new Error('No content URL found in SoFurry API response');
      }

      // Check if this is a video
      const isVideo = this.isVideoUrl(sourceImageUrl);
      
      // Format the submission title with author
      const title = response.data.title ? 
        `${response.data.title} by ${response.data.author}` : 
        `SoFurry submission by ${response.data.author}`;

      // Process and cache the media
      const processed = await mediaCache.processMediaUrl(sourceImageUrl, isVideo);
      
      // Return the data in the format expected by baseScraper
      if (isVideo) {
        return {
          imageUrl: processed.localPath, 
          videoUrl: processed.localPath,
          isVideo: true,
          sourceUrl: url,
          title: title,
          siteName: 'SoFurry',
          originalVideoUrl: sourceImageUrl,
          sourceImgUrl: sourceImageUrl // Add the sourceImgUrl field
        };
      } else {
        return {
          imageUrl: processed.localPath,
          isVideo: false,
          sourceUrl: url,
          title: title,
          siteName: 'SoFurry',
          originalImageUrl: sourceImageUrl,
          sourceImgUrl: sourceImageUrl // Add the sourceImgUrl field
        };
      }
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