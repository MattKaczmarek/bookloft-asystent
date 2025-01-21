// public/script.js

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

        if (desc.length > 0 && photoCount > 0) {
            complete++;
            row.classList.add('row-complete');
        } else if ((desc.length > 0 && photoCount === 0) ||
                   (desc.length === 0 && photoCount > 0)) {
            incomplete++;
            row.classList.add('row-incomplete');
        } else {
            row.classList.add('row-empty');
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
    alert('Tu docelowo: fetch("/exportDescriptions") i pobranie pliku CSV z Node');
});

// *** NAJWAŻNIEJSZA ZMIANA – obsługa eksportu zdjęć ***
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

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.classList.add('remove-photo');
    removeBtn.addEventListener('click', () => {
        socket.emit('removePhoto', {
            id: parseInt(id, 10),
            fileFull: photoObj.full,
            fileThumb: photoObj.thumb
        });
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

        const sorted = Array.from(files).sort((a,b) =>
            a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:'base' })
        );

        const formData = new FormData();
        formData.append('id', itemID);
        sorted.forEach(f => formData.append('photos[]', f));

        try {
            const resp = await fetch('/addPhotos', {
                method:'POST',
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
