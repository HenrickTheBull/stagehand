/**
 * Test script for the updater's change statistics functionality
 */
const updater = require('./utils/updater');

// Log test title
console.log('=== Testing Updater Change Statistics ===');

// Test with different commit ranges
async function runTests() {
  // Test with the most recent commit
  await updater.testChangeStats(1);
  
  // Test with the last 3 commits if they exist
  await updater.testChangeStats(3);
  
  // For testing the actual update functionality:
  // Uncomment the following line to test the manual update with real fetching
  // const updateResult = await updater.manualUpdate();
  // console.log('Update result:', updateResult ? 'Updates applied' : 'No updates available');
}

runTests().then(() => {
  console.log('Tests completed');
});
