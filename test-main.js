const { app, BrowserWindow } = require('electron');

console.log('Electron:', app);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600
  });
  
  win.loadURL('https://www.google.com');
  console.log('Window created successfully!');
});

app.on('window-all-closed', () => {
  app.quit();
});
