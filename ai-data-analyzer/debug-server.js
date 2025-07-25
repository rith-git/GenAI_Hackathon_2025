// debug-server.js
// Simple debug script to test MCP server components

console.log('🔍 Starting MCP Server Debug...\n');

// Test 1: Check Node.js version
console.log('📋 System Information:');
console.log(`Node.js version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
console.log(`Current directory: ${process.cwd()}\n`);

// Test 2: Check required modules
console.log('📦 Testing module imports...');

try {
  const express = require('express');
  console.log('✓ Express loaded');
} catch (error) {
  console.error('❌ Express failed:', error.message);
}

try {
  const cors = require('cors');
  console.log('✓ CORS loaded');
} catch (error) {
  console.error('❌ CORS failed:', error.message);
}

try {
  const multer = require('multer');
  console.log('✓ Multer loaded');
} catch (error) {
  console.error('❌ Multer failed:', error.message);
}

try {
  const fs = require('fs-extra');
  console.log('✓ fs-extra loaded');
} catch (error) {
  console.error('❌ fs-extra failed:', error.message);
}

try {
  const { LRUCache } = require('lru-cache');
  console.log('✓ LRU Cache loaded');
} catch (error) {
  console.error('❌ LRU Cache failed:', error.message);
  console.log('   Try: npm install lru-cache');
}

// Test 3: Check directories
console.log('\n📁 Testing directories...');

const path = require('path');
const fs = require('fs-extra');

try {
  const uploadsDir = path.join(__dirname, 'uploads');
  fs.ensureDirSync(uploadsDir);
  console.log(`✓ Uploads directory: ${uploadsDir}`);
} catch (error) {
  console.error('❌ Uploads directory failed:', error.message);
}

// Test 4: Test port availability
console.log('\n🔌 Testing port availability...');

const net = require('net');

function testPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.close(() => {
        console.log(`✓ Port ${port} is available`);
        resolve(true);
      });
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`❌ Port ${port} is in use`);
      } else {
        console.error(`❌ Port ${port} error:`, error.message);
      }
      resolve(false);
    });
  });
}

async function runPortTests() {
  await testPort(3001);
  await testPort(3002);
  await testPort(3003);
}

// Test 5: Simple Express server
console.log('\n🚀 Testing simple Express server...');

async function testSimpleServer() {
  try {
    const express = require('express');
    const app = express();
    
    app.get('/test', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    const server = app.listen(3099, () => {
      console.log('✓ Simple Express server started on port 3099');
      console.log('  Test: http://localhost:3099/test');
      
      // Close after 2 seconds
      setTimeout(() => {
        server.close(() => {
          console.log('✓ Simple server closed');
        });
      }, 2000);
    });
    
    server.on('error', (error) => {
      console.error('❌ Simple server error:', error);
    });
    
  } catch (error) {
    console.error('❌ Simple server test failed:', error);
  }
}

// Run all tests
async function runAllTests() {
  await runPortTests();
  await testSimpleServer();
  
  console.log('\n🎯 Debug complete! Check the results above.');
  console.log('\nIf all tests pass, try running: node mcp-server.js');
}

runAllTests().catch(console.error);