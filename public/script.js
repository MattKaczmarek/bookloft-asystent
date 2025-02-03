let socket;
let isDataImported = false;

document.addEventListener('DOMContentLoaded', () => {
    const splash = document.getElementById('splash-screen');
    const mainApp = document.getElementById('main-app');

    splash.addEventListener('animationend', () => {
        splash.style.display = 'none';
        mainApp.style.display = 'block';
    });

    // Inicjujemy socket.io
    socket = io();

    // Gdy serwer wyśle zaktualizowane dane
    socket.on('dataUpdate', (data) => {
        renderTable(data);
    });

    // Po podłączeniu poproś o aktualne dane
    socket.on('connect', () => {
        socket.emit('getData');
    });
});

/**
 * Uaktualnia liczniki
 */
function updateCounters() {
    const rows = document.querySelectorAll('#product-table tbody tr');
    let total = 0, complete = 0, incomplete = 0;

    rows.forEach(row => {
        total++;
        const desc = (row.querySelector('textarea')?.value || '').trim();
        const photoGrid = row.querySelector('.photo-grid');
        const photoCount = photoGrid ? photoGrid.querySelectorAll('.photo-item').length : 0;
        row.classList.remove('row-empty','row-incomplete','row-complete');

        // Zielony (row-complete): opis + minimum 4 zdjęcia
        if (desc.length > 0 && photoCount >= 4) {
            row.classList.add('row-complete');
            complete++;
        }
        // Czarny (row-empty): brak opisu i brak zdjęć
        else if (desc.length === 0 && photoCount === 0) {
            row.classList.add('row-empty');
        }
        // Żółty (row-incomplete): w każdym innym wypadku
        else {
            row.classList.add('row-incomplete');
            incomplete++;
        }
    });

    document.getElementById('counter-complete').textContent = `Gotowe: ${complete}`;
    document.getElementById('counter-incomplete').textContent = `Niekompletne: ${incomplete}`;
    document.getElementById('counter-total').textContent = `Razem: ${total}`;
}

// ---------------------------------------------------
// Eventy dla przycisków

document.getElementById('import-button').addEventListener('click', () => {
    if (isDataImported) {
        alert('Najpierw wyczyść dane.');
        return;
    }
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            complete: (results) => {
                socket.emit('importCSV', results.data);
                isDataImported = true;
            },
            error: (err) => {
                alert('Błąd odczytu pliku CSV: ' + err.message);
            }
        });
    });
    fileInput.click();
});

document.getElementById('clear-data-button').addEventListener('click', () => {
    if (!confirm('Czy na pewno chcesz wyczyścić dane?')) return;
    const pin = prompt('Aby wyczyścić dane, wpisz PIN (8892):');
    if (pin !== '8892') {
        alert('Niepoprawny PIN!');
        return;
    }
    socket.emit('clearData');
    isDataImported = false;
});

document.getElementById('export-descriptions-button').addEventListener('click', async () => {
    try {
        const resp = await fetch('/exportDescriptions');
        if (!resp.ok) {
            alert('Błąd eksportu opisów: ' + resp.status + ' ' + resp.statusText);
            return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'opisy_complete.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Błąd przy eksporcie opisów: ' + err);
    }
});

document.getElementById('export-photos-button').addEventListener('click', async () => {
    try {
        const resp = await fetch('/exportPhotos');
        if (!resp.ok) {
            alert('Błąd eksportu zdjęć: ' + resp.status + ' ' + resp.statusText);
            return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'zdjecia.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Błąd pobierania ZIP: ' + err);
    }
});

// ---------------------------------------------------
// Renderowanie tabeli

function renderTable(data) {
    const tbody = document.querySelector('#product-table tbody');
    tbody.innerHTML = '';
    if (!data) return;

    data.forEach(item => {
        const row = document.createElement('tr');
        row.dataset.id = item.id;

        // SKU
        const skuTd = document.createElement('td');
        skuTd.textContent = item.sku;
        row.appendChild(skuTd);

        // Tytuł
        const titleTd = document.createElement('td');
        titleTd.textContent = item.title;
        row.appendChild(titleTd);

        // Opis
        const descTd = document.createElement('td');
        descTd.classList.add('column-opisy');
        const textarea = document.createElement('textarea');
        textarea.value = item.description || '';
        textarea.placeholder = 'Wprowadź opis';
        textarea.addEventListener('blur', () => {
            socket.emit('updateDescription', {
                id: item.id,
                description: textarea.value
            });
        });
        descTd.appendChild(textarea);
        row.appendChild(descTd);

        // Zdjęcia
        const photosTd = document.createElement('td');
        photosTd.classList.add('column-zdjecia');
        const photoActions = document.createElement('div');
        photoActions.classList.add('photo-actions');

        const addBtn = document.createElement('button');
        addBtn.textContent = 'Dodaj';
        addBtn.addEventListener('click', () => handleAddPhotos(item.id));
        photoActions.appendChild(addBtn);

        const photoGrid = document.createElement('div');
        photoGrid.classList.add('photo-grid');

        if (item.photos && item.photos.length > 0) {
            item.photos.forEach(p => {
                photoGrid.appendChild(createPhotoItem(p, item.id));
            });
        }

        photosTd.appendChild(photoActions);
        photosTd.appendChild(photoGrid);
        row.appendChild(photosTd);
        tbody.appendChild(row);
    });

    // Obsługa sortowania zdjęć
    document.querySelectorAll('.photo-grid').forEach(grid => {
        new Sortable(grid, {
            animation: 150,
            handle: '.photo-item',
            onEnd: (evt) => {
                const rowEl = grid.closest('tr');
                const itemID = rowEl?.dataset.id;
                if (!itemID) return;

                const photoItems = Array.from(grid.querySelectorAll('.photo-item'));
                const newOrder = photoItems.map(item => item.dataset.full);

                socket.emit('updatePhotoOrder', {
                    id: parseInt(itemID, 10),
                    newOrder
                });
            }
        });
    });

    updateCounters();
}

// Tworzy pojedynczą miniaturkę
function createPhotoItem(photoObj, id) {
    const item = document.createElement('div');
    item.classList.add('photo-item');
    item.dataset.full = photoObj.full;

    const img = document.createElement('img');
    // Pobrane z folderu uploads:
    img.src = 'uploads/' + (photoObj.thumb || photoObj.full);

    // Dodaj event listener do powiększania zdjęcia
    img.addEventListener('click', (e) => {
        // Zapobiegamy konfliktowi z przeciąganiem
        e.stopPropagation();
        openImageModal('uploads/' + photoObj.full);
    });

   const removeBtn = document.createElement('button');
removeBtn.textContent = '×';
removeBtn.classList.add('remove-photo');
removeBtn.addEventListener('click', () => {
    if (confirm("Czekaj kurwa... na pewno chcesz to zrobić?")) {
        socket.emit('removePhoto', {
            id: parseInt(id, 10),
            fileFull: photoObj.full,
            fileThumb: photoObj.thumb
        });
    }
});

    item.appendChild(removeBtn);
    item.appendChild(img);
    return item;
}

// Dodawanie zdjęć -> wysyłamy pliki do /addPhotos (HTTP POST, Multer)
async function handleAddPhotos(itemID) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;

        // Sortujemy pliki po nazwie, aby trzymać kolejność
        const sorted = Array.from(files).sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        const formData = new FormData();
        formData.append('id', itemID);
        sorted.forEach(f => formData.append('photos[]', f));

        try {
            const resp = await fetch('/addPhotos', {
                method: 'POST',
                body: formData
            });
            const json = await resp.json();
            if (json.status !== 'ok') {
                alert(json.message || 'Błąd przy dodawaniu zdjęć.');
            }
            // Serwer i tak wyemituje dataUpdate => renderTable
        } catch (err) {
            alert('Błąd sieci przy dodawaniu zdjęć: ' + err);
        }
    });
    fileInput.click();
}

// Obsługa przycisku Miniaturki
document.getElementById('thumbnails-button').addEventListener('click', handleThumbnails);

async function handleThumbnails() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;

        // Pobierz wszystkie wiersze z klasą "row-complete" (gotowe pozycje)
        const completeRows = Array.from(document.querySelectorAll('#product-table tbody tr.row-complete'));
        
        // Przetwarzaj każdy wybrany plik
        for (const file of files) {
            // Wyciągnij numer gotowej pozycji z nazwy pliku (np. "0 (7)-Photoroom")
            const match = file.name.match(/0 \((\d+)\)-Photoroom/);
            if (match) {
                const targetIndex = parseInt(match[1], 10); // numer pozycji (1-based)
                if (targetIndex <= completeRows.length) {
                    const row = completeRows[targetIndex - 1];
                    const productId = row.dataset.id;

                    // Przygotuj dane do wysłania
                    const formData = new FormData();
                    formData.append('id', productId);
                    formData.append('photo', file);

                    try {
                        const resp = await fetch('/addThumbnail', {
                            method: 'POST',
                            body: formData
                        });
                        const json = await resp.json();
                        if (json.status !== 'ok') {
                            alert(json.message || 'Błąd przy dodawaniu miniaturki.');
                        }
                    } catch (err) {
                        alert('Błąd sieci przy dodawaniu miniaturki: ' + err);
                    }
                } else {
                    alert(`Nie znaleziono gotowej pozycji dla numeru ${targetIndex}`);
                }
            } else {
                alert('Plik ' + file.name + ' ma niepoprawną nazwę.');
            }
        }
    });

    fileInput.click();
}

// --- Funkcje modalu do powiększania zdjęć z zoomem i przesuwaniem ---

function openImageModal(imageUrl) {
  // Tworzymy overlay jako flex-container
  const overlay = document.createElement('div');
  overlay.id = 'image-modal';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.overflow = 'auto';

  // Kontener – shrink-wrap
  const container = document.createElement('div');
  container.id = 'modal-container';
  container.style.position = 'relative';
  container.style.display = 'inline-block';
  container.style.cursor = 'grab';

  // Element obrazka – ustawiony bez transformacji na starcie
  const img = document.createElement('img');
  img.src = imageUrl;
  img.style.display = 'block';
  img.style.position = 'relative';
  img.style.transformOrigin = 'center center';
  img.style.transition = 'transform 0.1s';
  img.style.transform = 'none';
  img.style.width = 'auto';
  img.style.height = 'auto';
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';

  container.appendChild(img);
  overlay.appendChild(container);

  // Przycisk zamykania
  const closeBtn = document.createElement('div');
  closeBtn.textContent = '×';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '20px';
  closeBtn.style.right = '20px';
  closeBtn.style.fontSize = '30px';
  closeBtn.style.color = '#fff';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.zIndex = '10001';
  overlay.appendChild(closeBtn);
  closeBtn.addEventListener('click', () => overlay.remove());

  // Początkowe wartości zoomu i przesunięcia
  let scale = 1;
  let minScale = 1;
  let posX = 0, posY = 0;

  // Po załadowaniu obrazu obliczamy skalę, żeby obraz zmieścił się w viewportie
  img.onload = function() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const initialScale = Math.min(1, vw / nw, vh / nh);
    scale = initialScale;
    minScale = initialScale;
    img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
  };

  // Zoomowanie przy użyciu scrolla – nie pozwalamy scale spaść poniżej minScale
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    scale = Math.min(Math.max(minScale, scale + delta), 5);
    img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
  });

  // Przesuwanie (pan)
  let isPanning = false;
  let startX = 0, startY = 0;
  container.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isPanning = true;
    startX = e.clientX - posX;
    startY = e.clientY - posY;
    container.style.cursor = 'grabbing';
  });
  container.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    posX = e.clientX - startX;
    posY = e.clientY - startY;
    img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
  });
  container.addEventListener('mouseup', () => {
    isPanning = false;
    container.style.cursor = 'grab';
  });
  container.addEventListener('mouseleave', () => {
    isPanning = false;
    container.style.cursor = 'grab';
  });

  document.body.appendChild(overlay);
}


