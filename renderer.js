let selectedFilePath = null;
let outputFilePath = null;
let originalFileSize = null;

const selectBtn = document.getElementById('selectBtn');
const outputBtn = document.getElementById('outputBtn');
const compressBtn = document.getElementById('compressBtn');
const resetBtn = document.getElementById('resetBtn');
const clearErrorBtn = document.getElementById('clearErrorBtn');

const fileInfoDiv = document.getElementById('fileInfo');
const outputInfoDiv = document.getElementById('outputInfo');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');

// History elements
const tabs = document.querySelectorAll('.tab');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyBody = document.getElementById('historyBody');
const historyEmpty = document.getElementById('historyEmpty');
const historyTableWrap = document.getElementById('historyTableWrap');
const historySummary = document.getElementById('historySummary');

const QUALITY_LABELS = {
  ultrafast: 'Fast',
  superfast: 'Balanced',
  fast: 'High Quality'
};

let fullHistory = [];

// ---------- Tabs ----------
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const viewId = tab.dataset.view;

    tabs.forEach((t) => {
      const isActive = t === tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.view').forEach((view) => {
      view.classList.toggle('hidden', view.id !== viewId);
    });

    if (viewId === 'historyView') {
      loadHistory();
    }
  });
});

// Select video file
selectBtn.addEventListener('click', async () => {
  try {
    const filePath = await window.electronAPI.selectFile();
    if (filePath) {
      selectedFilePath = filePath;
      displayFileInfo(filePath);
      checkReadyToCompress();
    }
  } catch (err) {
    showError('Failed to select file: ' + err.message);
  }
});

// Select output location
outputBtn.addEventListener('click', async () => {
  try {
    const fileName = getFileName(selectedFilePath);
    const baseFileName = fileName.split('.')[0];
    const prefilledName = `${baseFileName}-part1.mp4`;
    const filePath = await window.electronAPI.selectOutputDirectory(prefilledName);
    if (filePath) {
      outputFilePath = filePath;
      displayOutputInfo(filePath);
      checkReadyToCompress();
    }
  } catch (err) {
    showError('Failed to select output location: ' + err.message);
  }
});

// Compress video
compressBtn.addEventListener('click', async () => {
  if (!selectedFilePath || !outputFilePath) {
    showError('Please select both input and output files');
    return;
  }

  const quality = document.querySelector('input[name="quality"]:checked').value;

  compressBtn.disabled = true;
  document.getElementById('placeholderSection').classList.add('hidden');
  progressSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = 'Compressing... 0%';

  try {
    const result = await window.electronAPI.compressVideo(
      selectedFilePath,
      outputFilePath,
      quality
    );

    if (result.success) {
      showResults(result);
    }
  } catch (err) {
    showError('Compression failed: ' + err.message);
  } finally {
    compressBtn.disabled = false;
    progressSection.classList.add('hidden');
  }
});

// Reset UI
resetBtn.addEventListener('click', () => {
  selectedFilePath = null;
  outputFilePath = null;
  originalFileSize = null;

  document.getElementById('fileName').textContent = '';
  document.getElementById('fileSize').textContent = '';
  document.getElementById('outputPath').textContent = '';
  document.getElementById('filesList').innerHTML = '';

  fileInfoDiv.classList.add('hidden');
  outputInfoDiv.classList.add('hidden');
  resultsSection.classList.add('hidden');

  checkReadyToCompress();
});

// Clear error
clearErrorBtn.addEventListener('click', () => {
  errorSection.classList.add('hidden');
});

// Clear history
clearHistoryBtn.addEventListener('click', async () => {
  const confirmed = confirm('Clear the entire history? This only removes the log, not your video files.');
  if (!confirmed) return;

  try {
    await window.electronAPI.clearHistory();
    loadHistory();
  } catch (err) {
    alert('Could not clear history: ' + err.message);
  }
});

// ---------- History ----------
async function loadHistory() {
  try {
    fullHistory = await window.electronAPI.getHistory();
  } catch (err) {
    fullHistory = [];
  }
  renderHistory();
}

function renderHistory() {
  historyBody.innerHTML = '';

  if (!fullHistory || fullHistory.length === 0) {
    historyEmpty.classList.remove('hidden');
    historyTableWrap.classList.add('hidden');
    clearHistoryBtn.disabled = true;
    historySummary.textContent = '';
    return;
  }

  historyEmpty.classList.add('hidden');
  historyTableWrap.classList.remove('hidden');
  clearHistoryBtn.disabled = false;

  const totalOriginal = fullHistory.reduce((sum, e) => sum + (e.originalSize || 0), 0);
  const totalCompressed = fullHistory.reduce((sum, e) => sum + (e.compressedSize || 0), 0);
  const videoWord = fullHistory.length === 1 ? 'video' : 'videos';
  historySummary.textContent =
    `Last ${fullHistory.length} ${videoWord}: ${formatBytes(totalOriginal)} reduced to ${formatBytes(totalCompressed)}`;

  fullHistory.forEach((entry) => {
    const row = document.createElement('tr');

    const reduction = entry.originalSize
      ? Math.round(((entry.originalSize - entry.compressedSize) / entry.originalSize) * 100) + '%'
      : 'N/A';

    addCell(row, formatDate(entry.date));

    const videoCell = addCell(row, entry.inputName || 'Unknown');
    videoCell.classList.add('history-video');
    videoCell.title = entry.inputPath || '';

    addCell(row, entry.originalSize ? formatBytes(entry.originalSize) : 'N/A');
    addCell(row, formatBytes(entry.compressedSize || 0));

    const reductionCell = addCell(row, reduction);
    reductionCell.classList.add('history-reduction');

    addCell(row, String(entry.parts || 0));
    addCell(row, QUALITY_LABELS[entry.quality] || entry.quality || 'N/A');
    addCell(row, formatDuration(entry.processingSeconds));

    const actionCell = document.createElement('td');
    if (entry.files && entry.files.length > 0) {
      const btn = document.createElement('button');
      btn.className = 'history-show-btn';
      btn.textContent = 'Show in Folder';
      btn.addEventListener('click', async () => {
        const opened = await window.electronAPI.openFileLocation(entry.files[0].path);
        if (!opened) {
          alert('That folder no longer exists. The files may have been moved or deleted.');
        }
      });
      actionCell.appendChild(btn);
    }
    row.appendChild(actionCell);

    historyBody.appendChild(row);
  });

}

function addCell(row, text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatDuration(seconds) {
  if (seconds === undefined || seconds === null) return 'N/A';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ---------- Helper functions ----------
function displayFileInfo(filePath) {
  const fileName = getFileName(filePath);
  document.getElementById('fileName').textContent = fileName;

  window.electronAPI.getFileSize(filePath).then(size => {
    originalFileSize = size;
    document.getElementById('fileSize').textContent = formatBytes(size);
  }).catch(() => {
    document.getElementById('fileSize').textContent = 'Unknown';
  });

  fileInfoDiv.classList.remove('hidden');
}

function displayOutputInfo(filePath) {
  document.getElementById('outputPath').textContent = filePath;
  outputInfoDiv.classList.remove('hidden');
}

function showResults(result) {
  const reduction = Math.round(((originalFileSize - result.fileSize) / originalFileSize) * 100);

  document.getElementById('originalSize').textContent = formatBytes(originalFileSize);
  document.getElementById('compressedSize').textContent = formatBytes(result.fileSize);
  document.getElementById('reduction').textContent = reduction + '%';
  document.getElementById('partsCount').textContent = result.parts;

  const filesListDiv = document.getElementById('filesList');
  filesListDiv.innerHTML = '';

  result.files.forEach((file, index) => {
    const fileName = getFileName(file.path);
    const row = document.createElement('div');
    row.className = 'file-row';

    const label = document.createElement('span');
    label.textContent = `${fileName} (${formatBytes(file.size)})`;

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Show in Folder';
    openBtn.className = 'btn-file-link';
    openBtn.addEventListener('click', () => {
      window.electronAPI.openFileLocation(file.path);
    });

    row.appendChild(label);
    row.appendChild(openBtn);
    filesListDiv.appendChild(row);
  });

  resultsSection.classList.remove('hidden');
}

function showError(message) {
  document.getElementById('placeholderSection').classList.add('hidden');
  document.getElementById('errorText').textContent = message;
  errorSection.classList.remove('hidden');
  progressSection.classList.add('hidden');
}

function checkReadyToCompress() {
  compressBtn.disabled = !(selectedFilePath && outputFilePath);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Get just the file name from a full path (works on Windows and Mac)
function getFileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

// Listen for compression progress
window.electronAPI.onCompressionProgress((data) => {
  const progress = Math.min(data.progress, 100);
  document.getElementById('progressFill').style.width = progress + '%';
  document.getElementById('progressText').textContent = `Compressing... ${Math.round(progress)}%`;
});