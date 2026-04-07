import runSolaceConnectionTests from './solaceConnectionTest';

/**
 * Test Runner for Solace Connection Tests
 * 
 * This script runs tests to verify:
 * 1. The webapp can connect to Solace with the provided credentials
 * 2. The webapp can establish 3 different sessions with the correct subscriptions
 * 3. Sessions are properly cleaned up when the app exits
 */

async function runTests() {
  console.log('🧪 Starting SolCapital Dashboard Tests 🧪');
  
  // Run Solace connection tests
  await runSolaceConnectionTests();
  
  console.log('🏁 All tests completed 🏁');
}

// Run the tests
runTests()
  .then(() => {
    console.log('Tests finished successfully');
  })
  .catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });