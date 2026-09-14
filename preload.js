const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectOutputDirectory: (defaultFilename) => ipcRenderer.invoke('select-output-directory', defaultFilename),
  compressVideo: (inputPath, outputPath, quality) =>
    ipcRenderer.invoke('compress-video', { inputPath, outputPath, quality }),
  getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
  openFileLocation: (filePath) => ipcRenderer.invoke('open-file-location', filePath),
  onCompressionProgress: (callback) =>
    ipcRenderer.on('compression-progress', (event, data) => callback(data))
});