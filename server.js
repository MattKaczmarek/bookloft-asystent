const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIO = require('socket.io');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const { google } = require('googleapis'); // Dodajemy Google API

const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Jeśli uploads/ nie istnieje, stwórz go
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Funkcje do odczytu/zapisu danych lokalnych
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Serve static files (public + uploads)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.json());

// ------------------- File upload + thumbnail -------------------
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

// Konfiguracja Google Sheets API z kluczem API
const sheets = google.sheets({
  version: 'v4',
  auth: 'AIzaSyAgrOsPIF924YXYq-_TZVPeNZ89rRjpWuo', // Twój klucz API wstawiony bezpośrednio
});

app.get('/getSheetData', async (req, res) => {
  try {
    const spreadsheetId = '14HLypb1M8o3DKWof6a0yCuJ2NE3am6d77spO9NTyALY'; // Zapamiętane ID arkusza
    const range = 'A1:D3'; // Zakres z screena

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Brak danych w arkuszu.' });
    }

    // Funkcja konwertująca string z przecinkiem na liczbę
    const parsePolishNumber = (str) => {
      if (typeof str === 'string') {
        return parseFloat(str.replace(',', '.')) || 0;
      }
      return parseFloat(str) || 0;
    };

    // Parsowanie danych z arkusza z poprawną konwersją
    const data = {
      kasia: {
        sum: parsePolishNumber(rows[1][1]), // B2 - Suma Kasi
        average: parsePolishNumber(rows[2][1]), // B3 - Średnia Kasi
      },
      michal: {
        sum: parsePolishNumber(rows[1][3]), // D2 - Suma Michała
        average: parsePolishNumber(rows[2][3]), // D3 - Średnia Michała
      },
    };

    res.json({ status: 'ok', data });
  } catch (err) {
    console.error('Błąd przy pobieraniu danych z Google Sheets:', err);
    res.status(500).json({ status: 'error', message: 'Błąd serwera przy pobieraniu danych z arkusza.' });
  }
});

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

    for (const file of req.files) {
      const full = path.basename(file.path);
      const baseName = path.parse(full).name;
      const thumb = 'thumb_' + baseName + '.jpg';

      await sharp(file.path)
        .rotate()
        .resize({ width: 300 })
        .jpeg({ quality: 80 })
        .toFile(path.join(UPLOADS_DIR, thumb));

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

// ------------------- Export PHOTOS -------------------
app.get('/exportPhotos', (req, res) => {
  try {
    const data = loadData();
    const completeItems = data.filter(item =>
      item.description && item.description.trim() !== '' &&
      item.photos && item.photos.length >= 4
    );

    if (completeItems.length === 0) {
      return res.status(400).send('Brak kompletnych pozycji – nie ma co eksportować.');
    }

    const zip = archiver('zip', { zlib: { level: 0 } });
    res.setHeader('Content-Disposition', 'attachment; filename="zdjecia.zip"');
    res.setHeader('Content-Type', 'application/zip');
    zip.pipe(res);

    let zIndex = 1;
    for (const item of completeItems) {
      const folderName = `Z (${zIndex})/`;
      item.photos.forEach((photo, i) => {
        const fullPath = path.join(UPLOADS_DIR, photo.full);
        if (fs.existsSync(fullPath)) {
          const picName = folderName + `${i + 1}.jpg`;
          zip.file(fullPath, { name: picName });

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

// ------------------- Export DESCRIPTIONS to CSV -------------------
app.get('/exportDescriptions', (req, res) => {
  try {
    const data = loadData();
    if (!data.length) {
      return res.status(400).send('Brak danych – nie ma co eksportować.');
    }

    let csv = '';
    data.forEach(item => {
      if (item.description && item.description.trim() !== '' &&
          item.photos && item.photos.length >= 4) {
        const sku = csvEscape(item.sku || '');
        const title = csvEscape(item.title || '');
        const desc = csvEscape(item.description || '');
        let row = `${sku},${title},${desc}`;
        item.photos.forEach(photo => {
          const link = `${req.protocol}://${req.get('host')}/uploads/${photo.full}`;
          row += `,${csvEscape(link)}`;
        });
        csv += row + '\n';
      } else {
        csv += ',,\n';
      }
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="opisy_complete.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Błąd przy eksporcie opisów:', err);
    res.status(500).send('Błąd serwera przy eksporcie opisów.');
  }
});

function csvEscape(str) {
  const needsQuoting = /[",\r\n]/.test(str);
  let escaped = str.replace(/"/g, '""');
  if (needsQuoting) {
    escaped = `"${escaped}"`;
  }
  return escaped;
}

// ------------------- Socket.IO events -------------------
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

    const fullPath = path.join(__dirname, 'uploads', fileFull);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    const thumbPath = path.join(__dirname, 'uploads', fileThumb);
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

// Endpoint do dodawania miniaturki
app.post('/addThumbnail', upload.single('photo'), async (req, res) => {
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

    const file = req.file;
    if (!file) {
      return res.status(400).json({ status: 'error', message: 'Brak pliku' });
    }

    const full = path.basename(file.path);
    const baseName = path.parse(full).name;
    const thumb = 'thumb_' + baseName + '.jpg';

    await sharp(file.path)
      .rotate()
      .resize({ width: 300 })
      .jpeg({ quality: 80 })
      .toFile(path.join(UPLOADS_DIR, thumb));

    if (!item.photos) item.photos = [];
    item.photos.unshift({ full, thumb });

    saveData(data);
    io.emit('dataUpdate', data);
    res.json({ status: 'ok', data });
  } catch (err) {
    console.error('Błąd w /addThumbnail:', err);
    res.status(500).json({ status: 'error', message: 'Błąd serwera przy dodawaniu miniaturki.' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer uruchomiony na porcie ${PORT}`);
});
