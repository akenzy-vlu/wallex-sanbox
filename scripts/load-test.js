#!/usr/bin/env node

/**
 * Advanced load testing script using Node.js
 * Provides better control over concurrent requests and detailed statistics
 *
 * Usage: node load-test.js [options]
 *
 * Options:
 *   --wallet <id>         Wallet ID to test (default: test-wallet)
 *   --requests <number>   Total number of requests (default: 1000)
 *   --concurrent <number> Concurrent requests (default: 50)
 *   --credit <amount>     Credit amount per request (default: 20)
 *   --debit <amount>      Debit amount per request (default: 10)
 *   --type <credit|debit|mixed>  Type of test (default: mixed)
 *   --url <url>           Base URL (default: http://localhost:3000)
 */

const http = require('http');
const https = require('https');

// Parse command line arguments
const args = process.argv.slice(2);
const config = {
  walletId: getArg('--wallet', 'test-wallet'),
  totalRequests: parseInt(getArg('--requests', '1000')),
  concurrent: parseInt(getArg('--concurrent', '50')),
  creditAmount: parseFloat(getArg('--credit', '20')),
  debitAmount: parseFloat(getArg('--debit', '10')),
  testType: getArg('--type', 'mixed'), // credit, debit, or mixed
  baseUrl: getArg('--url', 'http://localhost:3000'),
};

function getArg(name, defaultValue) {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
}

// Statistics
const stats = {
  creditSuccess: 0,
  creditFailed: 0,
  debitSuccess: 0,
  debitFailed: 0,
  responseTimes: [],
  errors: {},
};

// HTTP request helper
function makeRequest(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, config.baseUrl);
    const client = url.protocol === 'https:' ? https : http;
    const startTime = Date.now();

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body ? Buffer.byteLength(body) : 0,
      },
    };

    const req = client.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        stats.responseTimes.push(responseTime);

        resolve({
          statusCode: res.statusCode,
          data: data,
          responseTime: responseTime,
        });
      });
    });

    req.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      stats.responseTimes.push(responseTime);

      resolve({
        statusCode: 0,
        error: error.message,
        responseTime: responseTime,
      });
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Send credit request
async function sendCreditRequest(requestNum) {
  const body = JSON.stringify({
    amount: config.creditAmount,
    description: `Load test credit #${requestNum}`,
  });

  const result = await makeRequest(
    'POST',
    `/wallets/${config.walletId}/credit`,
    body,
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    stats.creditSuccess++;
  } else {
    stats.creditFailed++;
    const errorKey = result.error || `HTTP ${result.statusCode}`;
    stats.errors[errorKey] = (stats.errors[errorKey] || 0) + 1;
  }

  return result;
}

// Send debit request
async function sendDebitRequest(requestNum) {
  const body = JSON.stringify({
    amount: config.debitAmount,
    description: `Load test debit #${requestNum}`,
  });

  const result = await makeRequest(
    'POST',
    `/wallets/${config.walletId}/debit`,
    body,
  );

  if (result.statusCode >= 200 && result.statusCode < 300) {
    stats.debitSuccess++;
  } else {
    stats.debitFailed++;
    const errorKey = result.error || `HTTP ${result.statusCode}`;
    stats.errors[errorKey] = (stats.errors[errorKey] || 0) + 1;
  }

  return result;
}

// Get wallet state
async function getWalletState() {
  const result = await makeRequest('GET', `/wallets/${config.walletId}`);
  if (result.statusCode === 200) {
    return JSON.parse(result.data);
  }
  return null;
}

// Calculate statistics
function calculateStats() {
  const sorted = [...stats.responseTimes].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);

  return {
    min: Math.min(...sorted),
    max: Math.max(...sorted),
    avg: total / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

// Run load test
async function runLoadTest() {
  console.log('==========================================');
  console.log('Load Test Configuration');
  console.log('==========================================');
  console.log(`Wallet ID: ${config.walletId}`);
  console.log(`Total Requests: ${config.totalRequests}`);
  console.log(`Concurrent: ${config.concurrent}`);
  console.log(`Test Type: ${config.testType}`);
  console.log(`Credit Amount: ${config.creditAmount}`);
  console.log(`Debit Amount: ${config.debitAmount}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log('==========================================\n');

  // Get initial state
  console.log('Fetching initial wallet state...');
  const initialState = await getWalletState();
  if (initialState) {
    console.log(`Initial Balance: ${initialState.balance}`);
    console.log(`Initial Version: ${initialState.version}\n`);
  } else {
    console.log('Warning: Could not fetch initial state\n');
  }

  console.log('Starting load test...\n');
  const startTime = Date.now();

  // Create request queue
  const requests = [];
  for (let i = 1; i <= config.totalRequests; i++) {
    let requestPromise;

    if (config.testType === 'credit') {
      requestPromise = sendCreditRequest(i);
    } else if (config.testType === 'debit') {
      requestPromise = sendDebitRequest(i);
    } else {
      // Mixed: alternate between credit and debit
      requestPromise = i % 2 === 0 ? sendCreditRequest(i) : sendDebitRequest(i);
    }

    requests.push(requestPromise);

    // Limit concurrent requests
    if (requests.length >= config.concurrent) {
      await Promise.race(requests);
      requests.splice(
        requests.findIndex((p) => p === requests[0]),
        1,
      );
    }

    // Progress indicator
    if (i % 100 === 0) {
      const progress = ((i / config.totalRequests) * 100).toFixed(1);
      process.stdout.write(
        `\rProgress: ${progress}% (${i}/${config.totalRequests})`,
      );
    }
  }

  // Wait for remaining requests
  await Promise.all(requests);

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  console.log('\n\nFetching final wallet state...');
  const finalState = await getWalletState();

  // Calculate and display results
  const responseStats = calculateStats();

  console.log('\n==========================================');
  console.log('Test Results');
  console.log('==========================================');
  console.log(`Total Requests: ${config.totalRequests}`);
  console.log(`Duration: ${duration.toFixed(2)}s`);
  console.log(
    `Requests per second: ${(config.totalRequests / duration).toFixed(2)}`,
  );
  console.log('');

  console.log('Credit Operations:');
  console.log(`  Successful: ${stats.creditSuccess}`);
  console.log(`  Failed: ${stats.creditFailed}`);
  console.log('');

  console.log('Debit Operations:');
  console.log(`  Successful: ${stats.debitSuccess}`);
  console.log(`  Failed: ${stats.debitFailed}`);
  console.log('');

  console.log('Overall:');
  console.log(`  Total Success: ${stats.creditSuccess + stats.debitSuccess}`);
  console.log(`  Total Failed: ${stats.creditFailed + stats.debitFailed}`);
  console.log(
    `  Success Rate: ${(((stats.creditSuccess + stats.debitSuccess) / config.totalRequests) * 100).toFixed(2)}%`,
  );
  console.log('');

  console.log('Response Times (ms):');
  console.log(`  Min: ${responseStats.min}`);
  console.log(`  Max: ${responseStats.max}`);
  console.log(`  Avg: ${responseStats.avg.toFixed(2)}`);
  console.log(`  Median: ${responseStats.median}`);
  console.log(`  95th percentile: ${responseStats.p95}`);
  console.log(`  99th percentile: ${responseStats.p99}`);
  console.log('');

  if (Object.keys(stats.errors).length > 0) {
    console.log('Error Summary:');
    Object.entries(stats.errors).forEach(([error, count]) => {
      console.log(`  ${error}: ${count}`);
    });
    console.log('');
  }

  if (initialState && finalState) {
    console.log('Balance:');
    console.log(`  Initial: ${initialState.balance}`);
    console.log(`  Final: ${finalState.balance}`);
    console.log(`  Change: ${finalState.balance - initialState.balance}`);

    const expectedChange =
      stats.creditSuccess * config.creditAmount -
      stats.debitSuccess * config.debitAmount;
    const actualChange = finalState.balance - initialState.balance;

    console.log(`  Expected Change: ${expectedChange}`);
    console.log(`  Actual Change: ${actualChange}`);
    console.log(`  Match: ${expectedChange === actualChange ? '✓' : '✗'}`);
    console.log('');

    console.log('Version:');
    console.log(`  Initial: ${initialState.version}`);
    console.log(`  Final: ${finalState.version}`);
    console.log(
      `  Events Created: ${finalState.version - initialState.version}`,
    );
  }

  console.log('==========================================');
}

// Run the test
runLoadTest().catch((error) => {
  console.error('Error running load test:', error);
  process.exit(1);
});
