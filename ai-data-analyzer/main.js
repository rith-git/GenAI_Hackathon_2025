const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs-extra');

let mainWindow;
let mcpServerProcess;

// Enable live reload for development
if (process.env.NODE_ENV === 'development') {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Allow CORS for Claude API calls
	  allowRunningInsecureContent: true,
	  experimentalFeatures: true
    },
    titleBarStyle: 'default',
    show: false // Don't show until ready
  });

  // Load the HTML file
  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Start MCP Server
    startMCPServer();
    
    // Focus the window
    if (process.platform === 'darwin') {
      mainWindow.focus();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopMCPServer();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Development tools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Menu setup
  createApplicationMenu();
}

function startMCPServer() {
  try {
    console.log('Starting MCP Server...');
    
    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, 'uploads');
    fs.ensureDirSync(uploadsDir);
    
    // Start the MCP server process
    mcpServerProcess = spawn('node', ['mcp-server.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    mcpServerProcess.stdout.on('data', (data) => {
      console.log(`MCP Server: ${data}`);
    });

    mcpServerProcess.stderr.on('data', (data) => {
      console.error(`MCP Server Error: ${data}`);
    });

    mcpServerProcess.on('close', (code) => {
      console.log(`MCP Server process exited with code ${code}`);
    });

    mcpServerProcess.on('error', (error) => {
      console.error('Failed to start MCP Server:', error);
      
      // Show error dialog
      dialog.showErrorBox(
        'MCP Server Error',
        `Failed to start MCP Server: ${error.message}\n\nThe application will continue in direct API mode.`
      );
    });

    console.log('MCP Server started successfully');
  } catch (error) {
    console.error('Error starting MCP Server:', error);
  }
}

function stopMCPServer() {
  if (mcpServerProcess) {
    console.log('Stopping MCP Server...');
    mcpServerProcess.kill('SIGTERM');
    mcpServerProcess = null;
  }
}

function createApplicationMenu() {
  const { Menu } = require('electron');
  
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data File',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'Data Files', extensions: ['csv', 'json', 'txt', 'xlsx'] },
                { name: 'CSV Files', extensions: ['csv'] },
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('file-selected', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export Analysis',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            mainWindow.webContents.send('export-analysis');
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Analysis',
      submenu: [
        {
          label: 'Start Master Agent Analysis',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.webContents.send('start-analysis');
          }
        },
        {
          label: 'Clear All Data',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            mainWindow.webContents.send('clear-all');
          }
        },
        { type: 'separator' },
        {
          label: 'MCP Server Status',
          click: () => {
            mainWindow.webContents.send('check-mcp-status');
          }
        },
        {
          label: 'Restart MCP Server',
          click: () => {
            stopMCPServer();
            setTimeout(() => startMCPServer(), 1000);
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About AI Master Agent',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About AI Master Agent Dashboard',
              message: 'AI Master Agent Dashboard',
              detail: `Version: 1.0.0
              
A sophisticated data analysis platform that uses Claude as a Master Agent to coordinate multiple data sources through MCP (Model Context Protocol) servers.

Features:
• Multi-source data coordination
• Real-time analysis orchestration  
• Dashboard integration ready
• MCP server connectivity
• Advanced file processing

Built with Electron, React, and Claude AI.`
            });
          }
        },
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://docs.anthropic.com');
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });

    // Window menu
    template[4].submenu = [
      { role: 'close' },
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App event handlers
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopMCPServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopMCPServer();
});

// IPC handlers for communication with renderer process
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-mcp-status', () => {
  return {
    running: mcpServerProcess !== null && !mcpServerProcess.killed,
    pid: mcpServerProcess ? mcpServerProcess.pid : null
  };
});

ipcMain.handle('restart-mcp-server', () => {
  stopMCPServer();
  setTimeout(() => startMCPServer(), 1000);
  return true;
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Handle certificate errors for HTTPS requests
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // For development, ignore certificate errors
  if (process.env.NODE_ENV === 'development') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (navigationEvent, navigationURL) => {
    navigationEvent.preventDefault();
    shell.openExternal(navigationURL);
  });
});

// Handle protocol for custom URL schemes (if needed for MCP)
app.setAsDefaultProtocolClient('ai-data-analyzer');

console.log('AI Master Agent Dashboard starting...');
console.log(`Electron version: ${process.versions.electron}`);
console.log(`Node version: ${process.versions.node}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);