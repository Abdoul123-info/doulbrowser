import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import * as crypto from 'crypto'

// Function to get hardware UUID (Machine ID)
export async function getMachineId(): Promise<string> {
  // [v1.8.6] Multi-Vault HWID Fallback System 🛡️
  const getFallbackRegistry = (): string | null => {
    if (process.platform !== 'win32') return null;
    try {
      const cmd = 'reg query "HKCU\\Software\\DoulGet" /v "MachineId"';
      const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const match = /MachineId\s+REG_SZ\s+(.*)/i.exec(output);
      return match ? match[1].trim() : null;
    } catch { return null; }
  };

  const saveFallbackRegistry = (id: string) => {
    if (process.platform !== 'win32') return;
    try {
      const cmd = `reg add "HKCU\\Software\\DoulGet" /v "MachineId" /t REG_SZ /d "${id}" /f`;
      execSync(cmd, { stdio: 'ignore' });
    } catch (e) { console.error('Registry save failed:', e); }
  };

  try {
    // 1. Try Native HWID (Primary)
    if (process.platform === 'win32') {
      const output = execSync('wmic csproduct get uuid').toString()
      const hwid = output.split('\n')[1].trim().toUpperCase()
      if (hwid && hwid !== 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF') return hwid;
    } else if (process.platform === 'darwin') {
      const output = execSync("ioreg -rd1 -c IOPlatformExpertDevice | grep -E '(uuid|IOPlatformUUID)'").toString()
      return output.split('"')[3].trim().toUpperCase()
    } else {
      const output = readFileSync('/var/lib/dbus/machine-id', 'utf8') || readFileSync('/etc/machine-id', 'utf8')
      return output.trim().toUpperCase()
    }
  } catch (e: any) {
    console.warn('Native HWID failed, entering multi-vault fallback...', e?.message);
  }

  // 2. Fallback Multi-Vault (AppData + Registry)
  try {
    const dataPath = app.getPath('userData');
    const idFile = join(dataPath, 'machine-id.txt');
    
    let idFromDisk: string | null = null;
    if (existsSync(idFile)) idFromDisk = readFileSync(idFile, 'utf8').trim().toUpperCase();
    
    const idFromReg = getFallbackRegistry();

    // Use existing ID if found in any vault
    const finalId = idFromDisk || idFromReg || ('UNKNOWN-' + process.platform + '-' + crypto.randomBytes(4).toString('hex')).toUpperCase();

    // Sync to all vaults
    if (idFromDisk !== finalId) writeFileSync(idFile, finalId, 'utf8');
    if (idFromReg !== finalId) saveFallbackRegistry(finalId);

    return finalId;
  } catch (err) {
    console.error('Multi-vault fallback failed:', err);
    return ('UNKNOWN-ID-' + process.platform).toUpperCase();
  }
}
