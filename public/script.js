let socket;
let isDataImported = false;
let isAppInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    // Sprawdź status sesji przy ładowaniu strony
    checkSession();

    // Obsługa formularza logowania
    document.getElementById('login-button').addEventListener('click', handleLogin);
    
    // Obsługa klawisza Enter w polach formularza logowania
    document.getElementById('username').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });
    
    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });

    // Obsługa wylogowania
    document.getElementById('logout-button').addEventListener('click', handleLogout);
});

// Funkcja sprawdzająca status sesji
function checkSession() {
    fetch('/api/session')
        .then(response => response.json())
        .then(data => {
            if (data.authenticated) {
                // Użytkownik jest zalogowany, inicjalizuj aplikację
                initializeApp();
                // Połącz z Socket.IO
                initializeSocketConnection();
                // Pokaż ekran powitalny
                showApp();
            } else {
                // Użytkownik nie jest zalogowany, pokaż ekran logowania
                document.getElementById('login-screen').classList.remove('hidden');
                document.getElementById('welcome-screen').classList.add('hidden');
                document.getElementById('main-app').classList.add('hidden');
            }
        })
        .catch(error => {
            console.error('Błąd sprawdzania sesji:', error);
            // W przypadku błędu, załóż że użytkownik nie jest zalogowany
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('welcome-screen').classList.add('hidden');
            document.getElementById('main-app').classList.add('hidden');
        });
}

// Funkcja obsługująca logowanie
function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember-me').checked;
    
    if (!username || !password) {
        document.getElementById('login-error').textContent = 'Wprowadź login i hasło';
        return;
    }
    
    fetch('/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password, remember })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.message || 'Błąd logowania');
            });
        }
        return response.json();
    })
    .then(data => {
        // Logowanie udane, inicjalizuj aplikację
        initializeApp();
        // Połącz z Socket.IO
        initializeSocketConnection();
        // Pokaż ekran powitalny
        showApp();
    })
    .catch(error => {
        document.getElementById('login-error').textContent = error.message || 'Nieprawidłowy login lub hasło';
    });
}

// Funkcja obsługująca wylogowanie
function handleLogout() {
    fetch('/api/logout', {
        method: 'POST'
    })
    .then(() => {
        // Wylogowanie udane, pokaż ekran logowania
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('main-app').classList.add('hidden');
        
        // Wyczyść pola formularza
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('remember-me').checked = false;
        document.getElementById('login-error').textContent = '';
        
        // Rozłącz socket
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        
        // Reset flagi inicjalizacji aplikacji, żeby po ponownym logowaniu wszystko działało
        isAppInitialized = false;
    })
    .catch(error => {
        console.error('Błąd wylogowania:', error);
    });
}

// Funkcja pokazująca aplikację po zalogowaniu
function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('welcome-screen').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
    
    // Pobierz dane z Google Sheets
    fetchSheetData();
}

// Inicjalizacja połączenia socket.io
function initializeSocketConnection() {
    socket = io({
        reconnectionAttempts: 5,
        timeout: 10000
    });

    socket.on('dataUpdate', (data) => {
        renderTable(data);
    });

    socket.on('connect', () => {
        socket.emit('getData');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Błąd połączenia Socket.IO:', error.message);
        
        // Jeśli błąd dotyczy autoryzacji, przekieruj do ekranu logowania
        if (error.message.includes('Nieautoryzowany') || error.message.includes('Unauthorized')) {
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('welcome-screen').classList.add('hidden');
            document.getElementById('main-app').classList.add('hidden');
            
            // Wyświetl komunikat o błędzie
            document.getElementById('login-error').textContent = 'Sesja wygasła. Zaloguj się ponownie.';
        }
    });
}

function initializeApp() {
    // Inicjalizuj aplikację tylko raz
    if (isAppInitialized) return;
    isAppInitialized = true;
    
    // Dodana obsługa przycisku "Zdjęcia"
    document.getElementById('photos-button').addEventListener('click', function() {
        // Bezpośrednio przełączamy widoki bez sprawdzania sesji
        document.getElementById('welcome-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        
        // Upewniamy się, że dane są załadowane
        if (socket && socket.connected) {
            socket.emit('getData');
        }
    });

    // Dodana obsługa przycisku "Home" (powrót do ekranu powitalnego)
    document.getElementById('home-button').addEventListener('click', () => {
        document.getElementById('main-app').classList.add('hidden');
        document.getElementById('welcome-screen').classList.remove('hidden');
    });
    
    setupButtonListeners();
}

function fetchSheetData() {
    fetch('/getSheetData')
        .then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    console.error('Błąd autoryzacji przy pobieraniu danych z arkusza');
                    // Nie przekierowujemy automatycznie do ekranu logowania
                    // Zamiast tego, ustawiamy domyślne wartości
                    throw new Error('Błąd autoryzacji');
                }
                throw new Error('Błąd pobierania danych z arkusza.');
            }
            return response.json();
        })
        .then(data => {
            if (data.status === 'ok') {
                // Aktualizacja tabeli powitalnej z pełnymi wartościami i przecinkiem
                const formatNumber = (num) => {
                    return num.toLocaleString('pl-PL', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });
                };

                // Aktualizacja tabeli powitalnej
                document.getElementById('kasia-sum').textContent = `Suma: ${formatNumber(data.data.kasia.sum)}`;
                document.getElementById('kasia-average').textContent = `Średnia: ${formatNumber(data.data.kasia.average)}`;
                document.getElementById('michal-sum').textContent = `Suma: ${formatNumber(data.data.michal.sum)}`;
                document.getElementById('michal-average').textContent = `Średnia: ${formatNumber(data.data.michal.average)}`;

                // Logika dla złotej korony
                const kasiaCrown = document.getElementById('kasia-crown');
                const michalCrown = document.getElementById('michal-crown');
                kasiaCrown.innerHTML = ''; // Czyścimy oba kontenery
                michalCrown.innerHTML = '';

                const kasiaSum = data.data.kasia.sum;
                const michalSum = data.data.michal.sum;

                if (kasiaSum > michalSum) {
                    kasiaCrown.innerHTML = '<span class="crown">👑</span>';
                } else if (michalSum > kasiaSum) {
                    michalCrown.innerHTML = '<span class="crown">👑</span>';
                }
                // Jeśli sumy są równe, korona nie pojawia się nigdzie
            } else {
                console.error('Błąd w danych:', data.message);
            }
        })
        .catch(error => {
            console.error('Błąd:', error.message);
            // Ustaw domyślne wartości w przypadku błędu
            document.getElementById('kasia-sum').textContent = 'Suma: 0,00';
            document.getElementById('kasia-average').textContent = 'Średnia: 0,00';
            document.getElementById('michal-sum').textContent = 'Suma: 0,00';
            document.getElementById('michal-average').textContent = 'Średnia: 0,00';

            // Czyścimy koronę w przypadku błędu
            document.getElementById('kasia-crown').innerHTML = '';
            document.getElementById('michal-crown').innerHTML = '';
        });
}

function updateCounters() {
    const rows = document.querySelectorAll('#product-table tbody tr');
    let total = 0, complete = 0, incomplete = 0;

    rows.forEach(row => {
        total++;
        const desc = (row.querySelector('textarea')?.value || '').trim();
        const photoGrid = row.querySelector('.photo-grid');
        const photoCount = photoGrid ? photoGrid.querySelectorAll('.photo-item').length : 0;
        row.classList.remove('row-empty', 'row-incomplete', 'row-complete');

        if (desc.length > 0 && photoCount >= 4) {
            row.classList.add('row-complete');
            complete++;
        }
        else if (desc.length === 0 && photoCount === 0) {
            row.classList.add('row-empty');
        }
        else {
            row.classList.add('row-incomplete');
            incomplete++;
        }
    });

    document.getElementById('counter-complete').textContent = `Gotowe: ${complete}`;
    document.getElementById('counter-incomplete').textContent = `Niekompletne: ${incomplete}`;
    document.getElementById('counter-total').textContent = `Razem: ${total}`;
}

function setupButtonListeners() {
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

    document.getElementById('thumbnails-button').addEventListener('click', handleThumbnails);
}

function renderTable(data) {
    const tbody = document.querySelector('#product-table tbody');
    tbody.innerHTML = '';
    if (!data) return;

    data.forEach(item => {
        const row = document.createElement('tr');
        row.dataset.id = item.id;

        const skuTd = document.createElement('td');
        skuTd.textContent = item.sku;
        row.appendChild(skuTd);

        const titleTd = document.createElement('td');
        titleTd.textContent = item.title;
        row.appendChild(titleTd);

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

function createPhotoItem(photoObj, id) {
    const item = document.createElement('div');
    item.classList.add('photo-item');
    item.dataset.full = photoObj.full;

    const img = document.createElement('img');
    img.src = 'uploads/' + (photoObj.thumb || photoObj.full);

    img.addEventListener('click', (e) => {
        e.stopPropagation();
        openImageModal('uploads/' + photoObj.full);
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.classList.add('remove-photo');
    removeBtn.addEventListener('click', () => {
        if (confirm("Na pewno chcesz usunąć to zdjęcie?")) {
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

async function handleAddPhotos(itemID) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;

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
        } catch (err) {
            alert('Błąd sieci przy dodawaniu zdjęć: ' + err);
        }
    });
    fileInput.click();
}

async function handleThumbnails() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;

        const completeRows = Array.from(document.querySelectorAll('#product-table tbody tr.row-complete'));
        
        for (const file of files) {
            const match = file.name.match(/0 \((\d+)\)-Photoroom/);
            if (match) {
                const targetIndex = parseInt(match[1], 10);
                if (targetIndex <= completeRows.length) {
                    const row = completeRows[targetIndex - 1];
                    const productId = row.dataset.id;

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

function openImageModal(imageUrl) {
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

    const container = document.createElement('div');
    container.id = 'modal-container';
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    container.style.cursor = 'grab';

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

    let scale = 1;
    let minScale = 1;
    let posX = 0, posY = 0;

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

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        scale = Math.min(Math.max(minScale, scale + delta), 5);
        img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
    });

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
