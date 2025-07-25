const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware with error handling
app.use(cors({
  origin: ['http://localhost:*', 'file://*'],
  credentials: true
}));

app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      console.error('Invalid JSON in request body:', e.message);
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
  }
}));

app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

console.log('✓ Express middleware configured');

// File upload configuration with error handling
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const uploadDir = path.join(__dirname, 'uploads');
      fs.ensureDirSync(uploadDir);
      console.log(`✓ Upload directory ready: ${uploadDir}`);
      cb(null, uploadDir);
    } catch (error) {
      console.error('❌ Error creating upload directory:', error);
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    try {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${timestamp}-${safeName}`;
      console.log(`Generated filename: ${filename}`);
      cb(null, filename);
    } catch (error) {
      console.error('❌ Error generating filename:', error);
      cb(error, null);
    }
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow specific file types
    const allowedTypes = /\.(csv|json|txt|xlsx|xls)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, JSON, TXT, and Excel files are allowed.'));
    }
  }
});

console.log('✓ File upload configuration ready');

const { LRUCache } = require('lru-cache');

// In-memory storage for connected data sources and analysis cache
let connectedSources = [
  { id: 'local-files', name: 'Local Files', type: 'file_system', status: 'active' },
  { id: 'claude-api', name: 'Claude API', type: 'ai_service', status: 'active' },
  { id: 'data-analyzer', name: 'Data Analyzer', type: 'analysis_tool', status: 'active' }
];

// Use LRU Cache for better memory management
const analysisCache = new LRUCache({
  max: 100, // Maximum 100 cached analyses
  maxSize: 50 * 1024 * 1024, // 50MB max cache size
  sizeCalculation: (value) => {
    return JSON.stringify(value).length;
  },
  ttl: 1000 * 60 * 60, // 1 hour TTL
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false
});

const uploadedFiles = new LRUCache({
  max: 50, // Maximum 50 uploaded files
  maxSize: 100 * 1024 * 1024, // 100MB max size
  sizeCalculation: (value) => {
    return value.size || 0;
  },
  ttl: 1000 * 60 * 60 * 24, // 24 hours TTL
  dispose: (value, key) => {
    // Clean up file when removed from cache
    try {
      if (value.path && fs.existsSync(value.path)) {
        fs.removeSync(value.path);
        console.log(`Cleaned up file: ${value.originalName}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup file: ${value.originalName}`, error);
    }
  }
});

// Master Agent Configuration
const masterAgentConfig = {
  maxConcurrentAnalyses: 3,
  analysisTimeout: 300000, // 5 minutes
  retryAttempts: 2,
  cacheExpiry: 3600000 // 1 hour
};

// Claude API configuration
const CLAUDE_API_URL = 'http://localhost:3001/api/claude-proxy';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Utility function to call Claude API
async function callClaudeAPI(messages, maxTokens = 4000) {
  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        messages: messages
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Claude API call failed:', error);
    throw error;
  }
}

// Convert file to base64
function fileToBase64(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.toString('base64'));
      }
    });
  });
}

// Determine media type from file extension
function getMediaType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel'
  };
  return mimeTypes[ext] || 'text/plain';
}

// Master Agent orchestration logic
async function orchestrateMasterAgentAnalysis(analysisRequest) {
  const { file_info, prompt, connectors, analysis_config } = analysisRequest;
  
  console.log('Master Agent starting orchestration:', {
    file: file_info.name,
    connectors: connectors.length,
    timestamp: new Date().toISOString()
  });

  // Step 1: Prepare file for analysis
  const fileKey = `${file_info.name}-${file_info.size}`;
  const uploadedFile = uploadedFiles.get(fileKey);
  
  if (!uploadedFile) {
    throw new Error('File not found in MCP server. Please upload the file first.');
  }

  // Step 2: Generate cache key
  const cacheKey = `${fileKey}-${Buffer.from(prompt).toString('base64').slice(0, 20)}`;
  
  // Check cache first
  if (analysisCache.has(cacheKey)) {
    const cached = analysisCache.get(cacheKey);
    console.log('Returning cached analysis');
    return cached;
  }

  // Step 3: Coordinate analysis across connected sources
  const analysisPromises = [];
  
  // Primary analysis with the uploaded file
  analysisPromises.push(performPrimaryAnalysis(uploadedFile, prompt, analysis_config));
  
  // Cross-reference analysis with other sources if enabled
  if (analysis_config.include_cross_reference) {
    analysisPromises.push(performCrossReferenceAnalysis(file_info, prompt, connectors));
  }

  // Execute all analyses
  const analysisResults = await Promise.allSettled(analysisPromises);
  
  // Step 4: Synthesize results using Master Agent
  const synthesizedResult = await synthesizeAnalysisResults(
    analysisResults, 
    file_info, 
    prompt, 
    analysis_config
  );

  // Step 5: Cache the result
  analysisCache.set(cacheKey, synthesizedResult);

  console.log('Master Agent orchestration complete');
  return synthesizedResult;
}

// Primary file analysis
async function performPrimaryAnalysis(fileData, prompt, config) {
  try {
    const base64Data = await fileToBase64(fileData.path);
    const mediaType = getMediaType(fileData.filename);

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data
            }
          },
          {
            type: 'text',
            text: `As a Master Agent coordinating data analysis, please analyze this file for: ${prompt}

Provide a comprehensive analysis with:
1. Data structure and quality assessment
2. Key statistical insights
3. Patterns and anomalies detected
4. Potential correlations and relationships
5. Actionable recommendations
6. Dashboard-ready metrics and KPIs

Format the response for integration with other data sources and dashboard visualization.`
          }
        ]
      }
    ];

    const analysis = await callClaudeAPI(messages, 4000);
    
    return {
      type: 'primary_analysis',
      source: 'uploaded_file',
      analysis: analysis,
      metadata: {
        filename: fileData.filename,
        size: fileData.size,
        mediaType: mediaType,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Primary analysis failed:', error);
    throw error;
  }
}

// Cross-reference analysis with other data sources
async function performCrossReferenceAnalysis(fileInfo, prompt, connectors) {
  try {
    const crossRefPrompt = `As a Master Agent, I need to perform cross-reference analysis for a ${fileInfo.type} file named "${fileInfo.name}".

Original analysis request: ${prompt}

Please provide insights on:
1. How this data might relate to common external data sources
2. Potential data enrichment opportunities
3. Industry benchmarks that might be relevant
4. Time-series patterns if applicable
5. Recommendations for multi-source data integration
6. Suggestions for additional data collection

Focus on actionable insights for dashboard integration and business intelligence.`;

    const messages = [
      {
        role: 'user',
        content: crossRefPrompt
      }
    ];

    const crossRefAnalysis = await callClaudeAPI(messages, 3000);
    
    return {
      type: 'cross_reference_analysis',
      source: 'external_knowledge',
      analysis: crossRefAnalysis,
      connectors_used: connectors,
      metadata: {
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Cross-reference analysis failed:', error);
    return {
      type: 'cross_reference_analysis',
      source: 'external_knowledge',
      analysis: 'Cross-reference analysis unavailable due to connectivity issues.',
      error: error.message
    };
  }
}

// Synthesize all analysis results
async function synthesizeAnalysisResults(analysisResults, fileInfo, prompt, config) {
  try {
    const successfulResults = analysisResults
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    const failedResults = analysisResults
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);

    if (successfulResults.length === 0) {
      throw new Error('All analysis attempts failed');
    }

    // Create synthesis prompt
    const synthesisPrompt = `As a Master Agent, synthesize the following analysis results into a comprehensive report:

ORIGINAL REQUEST: ${prompt}
FILE INFO: ${fileInfo.name} (${fileInfo.type})

ANALYSIS RESULTS:
${successfulResults.map((result, index) => `
--- ${result.type.toUpperCase()} (${result.source}) ---
${result.analysis}
`).join('\n')}

${failedResults.length > 0 ? `
FAILED ANALYSES: ${failedResults.length}
${failedResults.map(err => `- ${err.message || err}`).join('\n')}
` : ''}

Please provide:
1. EXECUTIVE SUMMARY - Key findings in 2-3 sentences
2. DETAILED INSIGHTS - Comprehensive analysis combining all sources
3. DASHBOARD METRICS - Specific KPIs and metrics for visualization
4. RECOMMENDATIONS - Actionable next steps
5. DATA INTEGRATION OPPORTUNITIES - How to leverage multiple data sources

Format the response for executive consumption and dashboard integration.`;

    const messages = [
      {
        role: 'user',
        content: synthesisPrompt
      }
    ];

    const synthesizedAnalysis = await callClaudeAPI(messages, 5000);

    // Extract dashboard data from the analysis
    const dashboardData = extractDashboardData(synthesizedAnalysis, successfulResults);

    return {
      analysis: synthesizedAnalysis,
      dashboard_data: dashboardData,
      metadata: {
        sources_used: successfulResults.length,
        failed_sources: failedResults.length,
        file_info: fileInfo,
        synthesis_timestamp: new Date().toISOString(),
        cache_key: `synthesis-${Date.now()}`
      }
    };
  } catch (error) {
    console.error('Synthesis failed:', error);
    throw error;
  }
}

// Extract dashboard-ready data from analysis
function extractDashboardData(analysisText, results) {
  const dashboardData = {
    summary_metrics: {},
    time_series: [],
    categories: [],
    recommendations: [],
    data_quality: {},
    sources: results.map(r => r.source)
  };

  try {
    // Simple extraction logic - in production, you'd want more sophisticated parsing
    const lines = analysisText.split('\n');
    
    lines.forEach(line => {
      // Extract metrics (looking for patterns like "metric: value")
      const metricMatch = line.match(/(\w+):\s*([0-9]+(?:\.[0-9]+)?)/);
      if (metricMatch) {
        dashboardData.summary_metrics[metricMatch[1]] = parseFloat(metricMatch[2]);
      }
      
      // Extract recommendations
      if (line.trim().startsWith('- ') && line.toLowerCase().includes('recommend')) {
        dashboardData.recommendations.push(line.trim().substring(2));
      }
    });

    // Add default metrics
    dashboardData.summary_metrics.analysis_timestamp = Date.now();
    dashboardData.summary_metrics.sources_count = results.length;
    
  } catch (error) {
    console.error('Dashboard data extraction failed:', error);
  }

  return dashboardData;
}

// API Routes

// Health check and status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'active',
    timestamp: new Date().toISOString(),
    connectors: connectedSources,
    cache: {
      analysis_entries: analysisCache.size,
      uploaded_files: uploadedFiles.size,
      memory_usage_mb: Math.round(analysisCache.calculatedSize / (1024 * 1024) * 100) / 100
    },
    version: '1.0.0'
  });
});

// Get connected data sources
app.get('/api/connectors', (req, res) => {
  res.json(connectedSources);
});

// Add new connector
app.post('/api/connectors', (req, res) => {
  const { id, name, type, config } = req.body;
  
  if (!id || !name || !type) {
    return res.status(400).json({ error: 'Missing required fields: id, name, type' });
  }

  const newConnector = {
    id,
    name,
    type,
    status: 'active',
    config: config || {},
    added_at: new Date().toISOString()
  };

  connectedSources.push(newConnector);
  
  res.json({ 
    message: 'Connector added successfully',
    connector: newConnector 
  });
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileInfo = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      source: req.body.source || 'unknown'
    };

    // Store file info for later analysis
    const fileKey = `${req.file.originalname}-${req.file.size}`;
    uploadedFiles.set(fileKey, fileInfo);

    console.log(`File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);

    res.json({
      message: 'File uploaded successfully',
      file_id: fileKey,
      file_info: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('File upload failed:', error);
    res.status(500).json({ error: 'File upload failed', details: error.message });
  }
});

// Master Agent analysis endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const analysisRequest = req.body;
    
    // Validate request
    if (!analysisRequest.file_info || !analysisRequest.prompt) {
      return res.status(400).json({ 
        error: 'Missing required fields: file_info, prompt' 
      });
    }

    console.log('Master Agent analysis request received:', {
      file: analysisRequest.file_info.name,
      prompt_length: analysisRequest.prompt.length,
      connectors: analysisRequest.connectors?.length || 0
    });

    // Set defaults
    analysisRequest.connectors = analysisRequest.connectors || [];
    analysisRequest.analysis_config = analysisRequest.analysis_config || {
      include_cross_reference: true,
      generate_insights: true,
      create_visualizations: false
    };

    // Orchestrate the analysis
    const result = await orchestrateMasterAgentAnalysis(analysisRequest);
    
    res.json(result);
  } catch (error) {
    console.error('Master Agent analysis failed:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get analysis cache status
app.get('/api/cache', (req, res) => {
  const cacheInfo = {
    size: analysisCache.size,
    max_size: analysisCache.max,
    memory_usage_mb: Math.round(analysisCache.calculatedSize / (1024 * 1024) * 100) / 100,
    max_memory_mb: Math.round(analysisCache.maxSize / (1024 * 1024) * 100) / 100,
    hit_ratio: analysisCache.size > 0 ? Math.round((analysisCache.size / (analysisCache.size + 1)) * 100) / 100 : 0,
    ttl_hours: analysisCache.ttl / (1000 * 60 * 60)
  };

  res.json(cacheInfo);
});

// Clear analysis cache
app.delete('/api/cache', (req, res) => {
  const oldSize = analysisCache.size;
  analysisCache.clear();
  
  res.json({
    message: 'Cache cleared',
    entries_removed: oldSize
  });
});

// Get uploaded files list
app.get('/api/files', (req, res) => {
  const files = [];
  
  for (const [key, file] of uploadedFiles.entries()) {
    files.push({
      id: key,
      name: file.originalName,
      size: file.size,
      type: file.mimetype,
      uploaded_at: file.uploadedAt,
      source: file.source
    });
  }

  res.json(files);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Start server with comprehensive error handling
const server = app.listen(PORT, (error) => {
  if (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
  
  console.log(`\n🚀 MCP Server with Master Agent started successfully!`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 API Status: http://localhost:${PORT}/api/status`);
  console.log(`📁 Connected Sources: ${connectedSources.length}`);
  console.log('==========================================\n');
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please try a different port.`);
    console.log('You can set a different port with: PORT=3002 node mcp-server.js');
  } else if (error.code === 'EACCES') {
    console.error(`❌ Permission denied on port ${PORT}. Try using a port > 1024.`);
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});

// Cleanup is now handled automatically by LRU cache
// Remove the old setInterval cleanup code since LRU cache handles it
console.log('LRU Cache cleanup is automatic - no manual cleanup needed');

module.exports = app;