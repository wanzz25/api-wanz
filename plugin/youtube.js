const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

function isValidYoutubeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    const validHostnames = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
    if (!validHostnames.includes(parsed.hostname)) return false;
    if (/[\s;'"<>()`|&]/.test(parsed.search) || /[\s;'"<>()`|&]/.test(parsed.pathname)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function getYtDlpPath() {
  const possiblePaths = [
    path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
    path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'youtube-dl.exe'),
    path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
    path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'youtube-dl'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'yt-dlp';
}

function downloadAudio(url, outputTemplate, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const binary = getYtDlpPath();
    const args = [
      '-f', 'bestaudio/best',
      '--js-runtimes', 'node',
      '-o', outputTemplate,
      '--no-warnings',
      '--print', 'after_move:filepath',
      url
    ];
    const child = spawn(binary, args);

    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
        reject(new Error('Timeout saat download audio dari Youtube'));
      }
    }, timeout);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `yt-dlp keluar dengan kode ${code}`));
      const filePath = stdout.trim();
      if (!filePath || !fs.existsSync(filePath)) {
        return reject(new Error('File hasil download tidak ditemukan'));
      }
      resolve(filePath);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Gagal menjalankan yt-dlp: ${err.message}`));
    });
  });
}

function convertToMp3(inputPath, outputPath, timeout = 120000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`File input tidak ditemukan: ${inputPath}`));
    }

    const ffmpegPath = ffmpegInstaller.path;
    const args = ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', outputPath];
    const child = spawn(ffmpegPath, args);

    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
        reject(new Error('Timeout saat convert ke MP3'));
      }
    }, timeout);

    let stderr = '';
    child.stderr.on('data', d => (stderr += d.toString()));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`FFmpeg gagal (kode ${code}): ${stderr.trim()}`));
      resolve(outputPath);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Gagal menjalankan ffmpeg: ${err.message}`));
    });
  });
}

module.exports = {
  name: "Youtube MP3 Downloader",
  desc: "Download audio dari video Youtube dan convert otomatis ke MP3 (butuh yt-dlp & ffmpeg jalan di server, tidak cocok untuk Vercel serverless).",
  category: "Downloader",
  path: "/api/download/youtube?apikey=&url=",
  async run(req, res) {
    const { url, apikey } = req.query;

    if (!apikey || !global.apikey.includes(apikey)) {
      return res.status(401).json({ status: false, error: "Apikey invalid atau tidak terdaftar" });
    }
    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi & harus link Youtube yang valid" });
    }

    const tempDir = os.tmpdir();
    const uniqueId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const rawTemplate = path.join(tempDir, `yt-${uniqueId}.%(ext)s`);
    const mp3Path = path.join(tempDir, `yt-${uniqueId}.mp3`);
    let rawPath = null;

    try {
      rawPath = await downloadAudio(url, rawTemplate);
      await convertToMp3(rawPath, mp3Path);

      res.download(mp3Path, 'youtube-audio.mp3', () => {
        if (fs.existsSync(mp3Path)) fs.unlink(mp3Path, () => {});
        if (rawPath && fs.existsSync(rawPath)) fs.unlink(rawPath, () => {});
      });
    } catch (error) {
      if (rawPath && fs.existsSync(rawPath)) {
        try { fs.unlinkSync(rawPath); } catch (_) {}
      }
      if (fs.existsSync(mp3Path)) {
        try { fs.unlinkSync(mp3Path); } catch (_) {}
      }
      return res.status(500).json({ status: false, error: "Gagal memproses video Youtube: " + error.message });
    }
  }
};
