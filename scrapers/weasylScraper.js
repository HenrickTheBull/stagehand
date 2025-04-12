const axios = require('axios');
const BaseScraper = require('./baseScraper');
const config = require('../config');

class WeasylScraper extends BaseScraper {
  constructor() {
    super();
    this.apiKey = process.env.WEASYL_API_KEY;
  }

  canHandle(url) {
    // This is for the site you called "Weasly", but I'm assuming it's "Weasyl"
    // Update config.js if needed to match the correct domain
    const weasylPattern = config.supportedSites.find(site => site.name === 'Weasyl' || site.name === 'Weasly').pattern;
    return weasylPattern.test(url);
  }

  async extract(url) {
    try {
      // Check if API key is available
      if (!this.apiKey) {
        throw new Error('Weasyl API key not found in environment variables. Please set WEASYL_API_KEY in your .env file.');
      }
      
      // Extract the submission ID from the URL
      const submissionId = this.extractSubmissionId(url);
      if (!submissionId) {
        throw new Error('Could not extract submission ID from Weasyl URL');
      }

      // Call the Weasyl API to get submission details
      const apiUrl = `https://www.weasyl.com/api/submissions/${submissionId}/view`;
      const response = await axios.get(apiUrl, {
        headers: {
          'X-Weasyl-API-Key': this.apiKey
        }
      });

      if (!response.data) {
        throw new Error('Failed to get data from Weasyl API');
      }

      // Get the submission URL from the API response
      const submissionData = response.data;
      const mediaEntries = submissionData.media?.submission;
      
      if (!mediaEntries || mediaEntries.length === 0) {
        throw new Error('No submission media found in Weasyl API response');
      }

      const imageUrl = mediaEntries[0].url;
      
      // Check if this is a video
      const isVideo = this.isVideoUrl(imageUrl);
      
      // Format the title with artist
      const title = submissionData.title ? 
        `${submissionData.title} by ${submissionData.owner}` : 
        `Weasyl submission by ${submissionData.owner}`;

      // Return the data in the format expected by baseScraper
      const result = {
        sourceUrl: url,
        title: title,
        siteName: 'Weasyl'
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
      console.error('Error extracting data from Weasyl:', error);
      throw new Error(`Failed to extract data from Weasyl: ${error.message}`);
    }
  }

  extractSubmissionId(url) {
    // Extract submission ID from various Weasyl URL formats
    
    // Format 1: https://www.weasyl.com/submission/2482447/mid-tf-fun
    let idMatches = url.match(/submission\/(\d+)/i);
    
    // Format 2: https://www.weasyl.com/~username/submissions/2482447/mid-tf-fun
    if (!idMatches) {
      idMatches = url.match(/submissions\/(\d+)/i);
    }
    
    // If we found a match, return the first capture group (the ID)
    return idMatches ? idMatches[1] : null;
  }
}

module.exports = new WeasylScraper();