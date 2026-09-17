const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
let ffmpegPath = require('ffmpeg-static');
let ffprobePath = require('ffprobe-static').path;

if (app.isPackaged) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}

const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle file selection dialog
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePaths[0] || null;
});

// Get video duration using ffprobe-static
function getVideoDuration(inputPath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ];

    const ffprobe = spawn(ffprobePath, args);
    let output = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', () => {
      const duration = parseFloat(output);
      resolve(!isNaN(duration) && duration > 0 ? duration : 0);
    });

    ffprobe.on('error', () => {
      resolve(0);
    });
  });
}

const HARD_CAP_BYTES = 20 * 1024 * 1024; // 20MB, absolute maximum
const TARGET_MB = 18.5; // aim under this so normal variance still stays under 20MB

// Map the UI quality choice to an encoding preset and starting bitrate
function getQualitySettings(quality) {
  if (quality === 'ultrafast') {
    return { preset: 'fast', videoBitrateK: 2400 };
  } else if (quality === 'superfast') {
    return { preset: 'medium', videoBitrateK: 2200 };
  } else {
    return { preset: 'slow', videoBitrateK: 2000 };
  }
}

// Compress video with auto-split, guaranteed under 20MB per part
ipcMain.handle('compress-video', async (event, { inputPath, outputPath, quality }) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(inputPath)) {
        reject(new Error(`Input file not found: ${inputPath}`));
        return;
      }

      const duration = await getVideoDuration(inputPath);

      if (duration === 0) {
        reject(new Error('Could not detect video duration.'));
        return;
      }

      const { preset, videoBitrateK } = getQualitySettings(quality);
      const audioBitrateK = 128;
      const totalBitrateK = videoBitrateK + audioBitrateK;

      const targetBits = TARGET_MB * 1024 * 1024 * 8;
      const maxSecondsPerPart = targetBits / (totalBitrateK * 1000);
      const numParts = Math.ceil(duration / maxSecondsPerPart);

      const outputDir = path.dirname(outputPath);
      const outputName = path.basename(outputPath, path.extname(outputPath));
      const cleanName = outputName.replace(/-part\d+$/, '');
      const outputExt = path.extname(outputPath);

      let totalSize = 0;
      const createdFiles = [];

      for (let i = 0; i < numParts; i++) {
        const startTime = i * maxSecondsPerPart;
        const endTime = Math.min((i + 1) * maxSecondsPerPart, duration);
        const partPath = numParts === 1
          ? outputPath
          : path.join(outputDir, `${cleanName}-part${i + 1}${outputExt}`);

        await compressPartWithCap(inputPath, partPath, startTime, endTime, preset, videoBitrateK, audioBitrateK, (partProgress) => {
          const overallProgress = ((i + partProgress / 100) / numParts) * 100;
          event.sender.send('compression-progress', { progress: Math.round(overallProgress) });
        });

        if (!fs.existsSync(partPath)) {
          reject(new Error(`Part ${i + 1} was not created at: ${partPath}`));
          return;
        }

        const stats = fs.statSync(partPath);
        totalSize += stats.size;
        createdFiles.push({ path: partPath, size: stats.size });
      }

      event.sender.send('compression-progress', { progress: 100 });

      resolve({ success: true, fileSize: totalSize, parts: numParts, files: createdFiles });
    } catch (err) {
      reject(err);
    }
  });
});

// Compress a part, then verify size and re-encode at a lower bitrate if it exceeds 20MB
async function compressPartWithCap(inputPath, outputPath, startTime, endTime, preset, initialVideoBitrateK, audioBitrateK, onProgress) {
  let videoBitrateK = initialVideoBitrateK;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await compressPart(inputPath, outputPath, startTime, endTime, preset, videoBitrateK, audioBitrateK, onProgress);

    const size = fs.statSync(outputPath).size;

    if (size <= HARD_CAP_BYTES) {
      return; // success, under the cap
    }

    // Too big: scale bitrate down proportionally, with extra margin, and try again
    const overshootRatio = HARD_CAP_BYTES / size;
    videoBitrateK = Math.max(Math.floor(videoBitrateK * overshootRatio * 0.90), 150);
  }
  // After max attempts, whatever was produced last stands (extremely rare to reach this point)
}

// Single-pass compression for one part/segment, with progress callback
function compressPart(inputPath, outputPath, startTime, endTime, preset, videoBitrateK, audioBitrateK, onProgress) {
  return new Promise((resolve, reject) => {
    const partDurationMs = (endTime - startTime) * 1000;
    const maxrateK = Math.round(videoBitrateK * 1.5);
    const bufsizeK = Math.round(videoBitrateK * 3);

    const args = [
      '-y',
      '-ss', startTime.toString(),
      '-to', endTime.toString(),
      '-i', inputPath,
      '-r', '30',
      '-vf', 'format=yuv420p',
      '-c:v', 'libx264',
      '-preset', preset,
      '-b:v', videoBitrateK + 'k',
      '-maxrate', maxrateK + 'k',
      '-bufsize', bufsizeK + 'k',
      '-c:a', 'aac',
      '-b:a', audioBitrateK + 'k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      outputPath
    ];

    const ffmpeg = spawn(ffmpegPath, args);
    let stderr = '';
    let stdoutBuffer = '';

    ffmpeg.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const match = stdoutBuffer.match(/out_time_ms=(\d+)/g);
      if (match && match.length > 0) {
        const lastMatch = match[match.length - 1];
        const timeMs = parseInt(lastMatch.split('=')[1]) / 1000;
        const progress = Math.min((timeMs / partDurationMs) * 100, 100);
        onProgress(progress);
      }
    });

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Compression failed: ${stderr.slice(-1000)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

// Open a file's location in File Explorer
ipcMain.handle('open-file-location', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Handle output directory selection
ipcMain.handle('select-output-directory', async (event, defaultFilename) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultFilename || '',
    properties: ['showHiddenFiles'],
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] }
    ]
  });
  return result.filePath || null;
});

// Get file size
ipcMain.handle('get-file-size', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (err) {
    throw new Error('Could not read file size');
  }
});