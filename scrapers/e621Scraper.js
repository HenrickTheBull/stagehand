const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');
const mediaCache = require('../utils/mediaCache');
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
      
      // Check for download link - for both images and videos
      let mediaUrl = $('#image-download-link').attr('href') || 
                     $('a[download]').attr('href') || 
                     $('#image').attr('src');
      
      // Extract OpenGraph data
      const ogImage = $('meta[property="og:image"]').attr('content');
      const ogUrl = $('meta[property="og:url"]').attr('content') || url;
      
      // Find potential video sources
      let videoUrl = $('video source').attr('src') || 
                    $('video').attr('src') || 
                    $('a:contains("original")').attr('href');
      
      // Use OpenGraph image if direct media URL not found
      if (!mediaUrl && ogImage) {
        mediaUrl = ogImage;
      }
      
      // Determine if we're dealing with a video post
      const isVideo = videoUrl || this.isVideoUrl(mediaUrl);
      
      // If it's a video, use the direct video URL
      if (isVideo && videoUrl) {
        mediaUrl = videoUrl;
      }
      
      if (!mediaUrl) {
        throw new Error('Could not find media on e621 page');
      }
      
      // Make sure URLs are absolute
      if (!mediaUrl.startsWith('http')) {
        if (mediaUrl.startsWith('//')) {
          mediaUrl = 'https:' + mediaUrl;
        } else if (mediaUrl.startsWith('/')) {
          mediaUrl = 'https://e621.net' + mediaUrl;
        }
      }
      
      // Store the original source URL before processing
      const sourceImageUrl = mediaUrl;
      
      // Process and cache the media
      const processed = await mediaCache.processMediaUrl(mediaUrl, isVideo);
      
      // Return appropriate data structure based on media type with generic title
      if (processed.isVideo) {
        return {
          imageUrl: processed.localPath,
          videoUrl: processed.localPath,
          isVideo: true,
          sourceUrl: ogUrl || url,
          title: "e621 Video", // Generic title without post-specific text
          siteName: 'e621',
          originalVideoUrl: sourceImageUrl,
          sourceImgUrl: sourceImageUrl // Add the sourceImgUrl field
        };
      } else {
        return {
          imageUrl: processed.localPath,
          sourceUrl: ogUrl || url,
          title: "e621 Image", // Generic title without post-specific text
          siteName: 'e621',
          isVideo: false,
          originalImageUrl: sourceImageUrl,
          sourceImgUrl: sourceImageUrl // Add the sourceImgUrl field
        };
      }
    } catch (error) {
      console.error('Error extracting data from e621:', error);
      throw new Error(`Failed to extract data from e621: ${error.message}`);
    }
  }
}

module.exports = new E621Scraper();