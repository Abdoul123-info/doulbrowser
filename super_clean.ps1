# Super Cleanup Script for DoulGet v1.2.6
Write-Host "--- MEGA CLEANUP START ---" -ForegroundColor Cyan

# 1. Kill Processes by Name
$processes = @("electron", "node")
foreach ($proc in $processes) {
    Write-Host "Stopping all $proc processes..."
    Get-Process -Name $proc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# 1b. Kill Processes by Port (Extensive Range)
Write-Host "Checking for port locks (5000-10000)..."
$ports = @(5173..5200) + @(8765) + @(9527..9530) + @(9999)
foreach ($port in $ports) {
    $found = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host "Killing process holding port $port..." -ForegroundColor Yellow
        $found | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
}

# 2. Clean 'out' folder
if (Test-Path "out") {
    Write-Host "Cleaning 'out' folder..."
    Remove-Item -Path "out" -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. Clean AppData Cache (Specific locks)
$appDataFolder = "$env:APPDATA\doul-browser"
if (Test-Path $appDataFolder) {
    Write-Host "Cleaning AppData: $appDataFolder"
    # Try deleting specific subfolders that usually lock
    $subs = @("Cache", "Code Cache", "GPUCache", "Local Storage", "Session Storage", "Network")
    foreach ($sub in $subs) {
        $path = Join-Path $appDataFolder $sub
        if (Test-Path $path) {
            Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -Path $appDataFolder -Recurse -Force -ErrorAction SilentlyContinue
}

# 4. Clean Vite Cache
if (Test-Path "node_modules/.vite") {
    Write-Host "Cleaning Vite cache..."
    Remove-Item -Path "node_modules/.vite" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "--- CLEANUP COMPLETE ---" -ForegroundColor Green
Write-Host "Now run: cmd /c 'set ELECTRON_RUN_AS_NODE=&& npm run dev'"
