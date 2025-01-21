// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver'); // <-- do generowania ZIP

// Pliki / katalogi
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Upewniamy się, że istnieje folder uploads
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Funkcje wczytania/zapisu data.json
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Serwujemy pliki statyczne (public) i folder uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.json());

// Konfiguracja Multer – zapisywanie oryginalnych plików
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniq = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniq + ext);
  }
});
const upload = multer({ storage });

// ==================== Dodawanie zdjęć + tworzenie miniaturek ====================
app.post('/addPhotos', upload.array('photos[]'), async (req, res) => {
  try {
    const id = parseInt(req.body.id, 10);
    if (!id) {
      return res.status(400).json({ status: 'error', message: 'Brak ID' });
    }

    let data = loadData();
    const item = data.find(d => d.id === id);
    if (!item) {
      return res.status(404).json({ status: 'error', message: 'Nie znaleziono elementu o danym ID' });
    }

    // Obsługa każdego przesłanego pliku
    for (const file of req.files) {
      const full = path.basename(file.path);
      // Tworzymy nazwę miniatury .jpg
      const baseName = path.parse(full).name; 
      const thumb = 'thumb_' + baseName + '.jpg';

      // Generowanie miniatury (300px szerokości)
      await sharp(file.path)
        .resize({ width: 300 })
        .jpeg({ quality: 80 })
        .toFile(path.join(UPLOADS_DIR, thumb));

      // Dodanie wpisu w data.json
      item.photos.push({ full, thumb });
    }

    saveData(data);
    io.emit('dataUpdate', data);

    res.json({ status: 'ok', data });
  } catch (err) {
    console.error('Błąd w /addPhotos:', err);
    res.status(500).json({ status: 'error', message: 'Błąd serwera przy dodawaniu zdjęć.' });
  }
});

// ==================== Eksport zdjęć do ZIP ====================
app.get('/exportPhotos', (req, res) => {
  try {
    const data = loadData();

    // Filtrujemy tylko "kompletne" (jest description + >=1 photo)
    const completeItems = data.filter(item =>
      item.description && item.description.trim() !== '' &&
      item.photos && item.photos.length > 0
    );

    if (completeItems.length === 0) {
      return res.status(400).send('Brak kompletnych pozycji – nie ma co eksportować.');
    }

    // Tworzymy ZIP
    const zip = archiver('zip', { zlib: { level: 9 } });
    res.setHeader('Content-Disposition', 'attachment; filename="zdjecia.zip"');
    res.setHeader('Content-Type', 'application/zip');
    zip.pipe(res);

    // Będzie dodatkowy folder "miniaturki" na 1-sze zdjęcia
    // (nie musimy go tworzyć pustego – wystarczy, że w nim umieścimy pliki)
    
    let zIndex = 1;
    for (const item of completeItems) {
      const folderName = `Z (${zIndex})/`;

      // Pełne zdjęcia w kolejności (1.jpg, 2.jpg, itp.)
      item.photos.forEach((photo, i) => {
        const fullPath = path.join(UPLOADS_DIR, photo.full);
        if (fs.existsSync(fullPath)) {
          // Nazwa w archiwum: "Z (X)/n.jpg", gdzie n = i+1
          const picName = `${folderName}${i + 1}.jpg`;
          zip.file(fullPath, { name: picName });

          // Pierwsze zdjęcie (i=0) trafi także do "miniaturki/0 (zIndex).jpg"
          if (i === 0) {
            const miniName = `miniaturki/0 (${zIndex}).jpg`;
            zip.file(fullPath, { name: miniName });
          }
        }
      });

      zIndex++;
    }

    zip.finalize();
  } catch (err) {
    console.error('Błąd przy eksporcie zdjęć:', err);
    res.status(500).send('Błąd serwera przy eksporcie zdjęć.');
  }
});

// ============================= Socket.IO =============================
io.on('connection', (socket) => {
  console.log('Klient połączony:', socket.id);

  socket.on('getData', () => {
    const data = loadData();
    socket.emit('dataUpdate', data);
  });

  socket.on('importCSV', (rows) => {
    let newData = [];
    let idCounter = 1;
    for (const row of rows) {
      if (row.length >= 2) {
        const sku = (row[0] || '').trim();
        const title = (row[1] || '').trim();
        if (sku && title) {
          newData.push({
            id: idCounter++,
            sku,
            title,
            description: '',
            photos: []
          });
        }
      }
    }
    saveData(newData);
    io.emit('dataUpdate', newData);
  });

  socket.on('updateDescription', ({ id, description }) => {
    const data = loadData();
    const item = data.find(d => d.id === id);
    if (item) {
      item.description = description;
      saveData(data);
      io.emit('dataUpdate', data);
    }
  });

  socket.on('removePhoto', ({ id, fileFull, fileThumb }) => {
    const data = loadData();
    const item = data.find(d => d.id === id);
    if (!item) return;

    item.photos = item.photos.filter(p => !(p.full === fileFull && p.thumb === fileThumb));
    saveData(data);

    const fullPath = path.join(UPLOADS_DIR, fileFull);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    const thumbPath = path.join(UPLOADS_DIR, fileThumb);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    io.emit('dataUpdate', data);
  });

  socket.on('clearData', () => {
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
    if (fs.existsSync(UPLOADS_DIR)) {
      fs.readdirSync(UPLOADS_DIR).forEach(file => {
        fs.unlinkSync(path.join(UPLOADS_DIR, file));
      });
    }
    saveData([]);
    io.emit('dataUpdate', []);
  });

  socket.on('updatePhotoOrder', ({ id, newOrder }) => {
    const data = loadData();
    const item = data.find(d => d.id === id);
    if (item && item.photos) {
      const oldList = item.photos;
      let ordered = [];
      for (const fullName of newOrder) {
        const found = oldList.find(p => p.full === fullName);
        if (found) ordered.push(found);
      }
      item.photos = ordered;
      saveData(data);
      io.emit('dataUpdate', data);
    }
  });

  socket.on('disconnect', () => {
    console.log('Klient rozłączony:', socket.id);
  });
});

// ===================== Start serwera na porcie 3000 =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});
