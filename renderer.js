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
    const fileName = selectedFilePath.split('\\').pop();
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

// Helper functions
function displayFileInfo(filePath) {
  const fileName = filePath.split('\\').pop();
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
    const fileName = file.path.split('\\').pop();
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
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Listen for compression progress
window.electronAPI.onCompressionProgress((data) => {
  const progress = Math.min(data.progress, 100);
  document.getElementById('progressFill').style.width = progress + '%';
  document.getElementById('progressText').textContent = `Compressing... ${Math.round(progress)}%`;
});