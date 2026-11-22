// --- ESTADO GLOBAL ---
let postits = [];
let currentSha = null;
let hasLocalChanges = false;
let config = {};

// Paleta de colores predefinida
const COLORS = ['#fdfd96', '#ffb7b2', '#b5ead7', '#c7ceea', '#e2f0cb'];

// --- ELEMENTOS DEL DOM ---
const board = document.getElementById('board');
const btnNew = document.getElementById('btn-new');
const btnSaveGit = document.getElementById('btn-save-git');
const btnConfig = document.getElementById('btn-config');
const statusText = document.getElementById('status-text');

// Modal
const modal = document.getElementById('config-modal');
const inputUser = document.getElementById('conf-user');
const inputRepo = document.getElementById('conf-repo');
const inputBranch = document.getElementById('conf-branch');
const inputPath = document.getElementById('conf-path');
const inputToken = document.getElementById('conf-token');
const btnSaveConfig = document.getElementById('btn-save-config');
const btnForget = document.getElementById('btn-forget');
const configError = document.getElementById('config-error');

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    if (!config.token || !config.user || !config.repo) {
        openConfig();
    } else {
        fetchFromGit();
    }
});

// Avisar antes de salir si hay cambios sin subir
window.addEventListener('beforeunload', (e) => {
    if (hasLocalChanges) {
        e.preventDefault();
        e.returnValue = 'Tenés cambios guardados en este equipo que aún no se subieron a GitHub.';
    }
});

// --- CONFIGURACIÓN ---
function loadConfig() {
    const saved = localStorage.getItem('postit_config');
    if (saved) {
        config = JSON.parse(saved);
        inputUser.value = config.user || '';
        inputRepo.value = config.repo || '';
        inputBranch.value = config.branch || 'data';
        inputPath.value = config.path || 'data/datos.json';
        // El token no se muestra por seguridad, lo dejamos en memoria.
    }
}

function openConfig() {
    modal.classList.remove('hidden');
    configError.textContent = '';
}

btnConfig.addEventListener('click', openConfig);

btnSaveConfig.addEventListener('click', () => {
    const newToken = inputToken.value.trim();
    if (newToken) config.token = newToken; // Solo actualiza si se escribió algo
    
    config.user = inputUser.value.trim();
    config.repo = inputRepo.value.trim();
    config.branch = inputBranch.value.trim() || 'data';
    config.path = inputPath.value.trim() || 'data/datos.json';
    
    localStorage.setItem('postit_config', JSON.stringify(config));
    inputToken.value = ''; // Limpiar campo
    modal.classList.add('hidden');
    fetchFromGit(); // Refrescar datos con la nueva config
});

btnForget.addEventListener('click', () => {
    localStorage.removeItem('postit_config');
    localStorage.removeItem('postit_local_data');
    config = {};
    postits = [];
    currentSha = null;
    hasLocalChanges = false;
    renderBoard();
    inputUser.value = ''; inputRepo.value = ''; inputToken.value = '';
    setStatus('Token y datos borrados. Ingresá configuración.');
});

// --- COMUNICACIÓN CON GITHUB ---

// Base64 UTF-8 Encode/Decode (Soporte Tildes y Ñ)
function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const binString = String.fromCodePoint(...bytes);
    return btoa(binString);
}

function base64ToUtf8(b64) {
    const binString = atob(b64);
    const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0));
    return new TextDecoder().decode(bytes);
}

async function fetchFromGit() {
    setStatus('Conectando con GitHub...');
    try {
        const url = `https://api.github.com/repos/${config.user}/${config.repo}/contents/${config.path}?ref=${config.branch}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
        });

        if (response.status === 404) {
            // El archivo no existe, lo crearemos en la primera subida
            postits = [];
            currentSha = null;
            setStatus('Archivo no existe en repo. Se creará al guardar.');
            checkLocalDifferences([]);
            return;
        }

        if (!response.ok) throw new Error(handleGitError(response.status));

        const data = await response.json();
        currentSha = data.sha;
        
        const decodedContent = base64ToUtf8(data.content);
        const serverPostits = JSON.parse(decodedContent);
        
        checkLocalDifferences(serverPostits);

    } catch (err) {
        setStatus(`Error de lectura: ${err.message}`);
        // Si hay error, intentamos cargar lo local para no perder funcionalidad
        loadLocalData();
    }
}

// Dos niveles de guardado: revisar si lo local difiere del servidor
function checkLocalDifferences(serverPostits) {
    const localDataRaw = localStorage.getItem('postit_local_data');
    
    if (localDataRaw) {
        // Comparar básico para saber si hay diferencias (podría ser más complejo)
        const serverDataRaw = JSON.stringify(serverPostits);
        if (localDataRaw !== serverDataRaw) {
            const recuperar = confirm("Tenés cambios locales sin subir a GitHub. ¿Querés recuperar tus cambios locales?\n\nAceptar = Conservar locales.\nCancelar = Descartar y usar los de GitHub.");
            if (recuperar) {
                postits = JSON.parse(localDataRaw);
                hasLocalChanges = true;
                setStatus('Cambios locales recuperados. ¡Falta subir a GitHub!');
                btnSaveGit.disabled = false;
                renderBoard();
                return;
            }
        }
    }
    
    // Si no hay locales, o el usuario decidió descartarlos
    postits = serverPostits;
    saveLocalData(false); // Fija el local igual al server, sin marcar como pendiente
    setStatus('Sincronizado con GitHub.');
    btnSaveGit.disabled = true;
    renderBoard();
}

btnSaveGit.addEventListener('click', async () => {
    if (!config.token) return openConfig();
    
    btnSaveGit.disabled = true;
    setStatus('Subiendo a GitHub...');
    
    const contentStr = JSON.stringify(postits, null, 2);
    const base64Content = utf8ToBase64(contentStr);
    
    const dateStr = new Date().toLocaleString('es-AR', { hour12: false });
    const bodyData = {
        message: `Actualización de datos – ${dateStr}`,
        content: base64Content,
        branch: config.branch
    };
    if (currentSha) bodyData.sha = currentSha; // Necesario para actualizar
    
    try {
        const url = `https://api.github.com/repos/${config.user}/${config.repo}/contents/${config.path}`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(bodyData)
        });
        
        if (response.status === 409) {
            throw new Error('409 Conflict - Alguien más modificó el archivo.');
        }
        if (!response.ok) throw new Error(handleGitError(response.status));
        
        const data = await response.json();
        currentSha = data.content.sha; // Actualizar SHA
        
        hasLocalChanges = false;
        setStatus(`Subido a las ${new Date().toLocaleTimeString('es-AR', { hour12: false })}`);
        
    } catch (err) {
        setStatus(`Error al subir: ${err.message}`);
        btnSaveGit.disabled = false; // Permitir reintento
        if (err.message.includes('409')) {
            alert("El archivo cambió en el servidor. Te sugerimos recargar la página y decidir si pisar o conservar.");
        }
    }
});

function handleGitError(status) {
    if (status === 401) return '401 - Token inválido o vencido';
    if (status === 403) return '403 - Sin permisos de escritura en este repo';
    if (status === 404) return '404 - Ruta, usuario o repo no encontrados. Revisá la config.';
    return `${status} - Error desconocido`;
}

// --- GUARDADO LOCAL ---
function saveLocalData(markAsChanged = true) {
    localStorage.setItem('postit_local_data', JSON.stringify(postits));
    if (markAsChanged) {
        hasLocalChanges = true;
        btnSaveGit.disabled = false;
        setStatus('Cambios guardados en este equipo');
    }
}

function loadLocalData() {
    const raw = localStorage.getItem('postit_local_data');
    if (raw) {
        postits = JSON.parse(raw);
        hasLocalChanges = true;
        btnSaveGit.disabled = false;
        renderBoard();
        setStatus('Mostrando versión local offline.');
    }
}

function setStatus(msg) {
    statusText.textContent = msg;
}

// --- LOGICA DE POST-ITS (UI & ABM) ---

btnNew.addEventListener('click', () => {
    const nuevo = {
        id: Date.now(),
        texto: 'Doble clic para editar...',
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        fecha: new Date().toLocaleDateString('es-AR'),
        x: window.innerWidth / 2 - 100,
        y: window.innerHeight / 2 - 100,
        rotation: (Math.random() * 6) - 3 // Rotación leve de -3 a 3 grados
    };
    postits.push(nuevo);
    saveLocalData();
    renderBoard();
});

function renderBoard() {
    board.innerHTML = ''; // Limpiar tablero
    postits.forEach(p => {
        const el = document.createElement('div');
        el.className = 'postit';
        el.style.backgroundColor = p.color || COLORS[0];
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        const rot = p.rotation || 0;
        el.style.transform = `rotate(${rot}deg)`;
        
        // Contenido
        const textDiv = document.createElement('div');
        textDiv.className = 'postit-text';
        textDiv.textContent = p.texto;
        
        // Footer (Fecha y Paleta)
        const footer = document.createElement('div');
        footer.className = 'postit-footer';
        
        const dateSpan = document.createElement('span');
        dateSpan.textContent = p.fecha;
        
        const palette = document.createElement('div');
        palette.className = 'color-palette';
        COLORS.forEach(c => {
            const dot = document.createElement('div');
            dot.className = 'color-dot';
            dot.style.backgroundColor = c;
            // Evitar que el clic en el color arrastre el postit
            dot.addEventListener('mousedown', e => e.stopPropagation());
            dot.addEventListener('click', () => {
                p.color = c;
                saveLocalData();
                renderBoard();
            });
            palette.appendChild(dot);
        });
        
        footer.appendChild(dateSpan);
        footer.appendChild(palette);
        
        // Botón Borrar
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-delete';
        btnDel.textContent = 'X';
        btnDel.title = 'Borrar Post-it';
        btnDel.addEventListener('mousedown', e => e.stopPropagation());
        btnDel.addEventListener('click', () => {
            if (confirm('¿Borrar este post-it?')) {
                postits = postits.filter(item => item.id !== p.id);
                saveLocalData();
                renderBoard();
            }
        });
        
        // Ensamblar
        el.appendChild(btnDel);
        el.appendChild(textDiv);
        el.appendChild(footer);
        board.appendChild(el);
        
        // --- EVENTOS DE INTERACCIÓN ---
        
        // Edición de texto (Doble clic)
        textDiv.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const textarea = document.createElement('textarea');
            textarea.className = 'postit-textarea';
            textarea.value = p.texto;
            
            el.replaceChild(textarea, textDiv);
            textarea.focus();
            
            const guardarTexto = () => {
                p.texto = textarea.value.trim() || 'Vacío...';
                saveLocalData();
                renderBoard();
            };
            
            // Guardar al perder el foco
            textarea.addEventListener('blur', guardarTexto);
            // Evitar que el drag empiece si hacemos clic en el textarea
            textarea.addEventListener('mousedown', ev => ev.stopPropagation());
        });
        
        // Drag and Drop
        el.addEventListener('mousedown', (e) => {
            if (e.target.tagName.toLowerCase() === 'textarea') return;
            
            // Traer al frente
            el.style.zIndex = Date.now();
            
            // Remover transición durante arrastre para evitar lag visual
            el.style.transition = 'none'; 
            
            let shiftX = e.clientX - el.getBoundingClientRect().left;
            let shiftY = e.clientY - el.getBoundingClientRect().top;
            
            // Compensar el header
            const boardTop = board.getBoundingClientRect().top;
            
            function moveAt(pageX, pageY) {
                let newX = pageX - shiftX;
                let newY = pageY - shiftY - boardTop;
                
                // Límites de pantalla (opcional)
                if(newX < 0) newX = 0;
                if(newY < 0) newY = 0;
                
                el.style.left = newX + 'px';
                el.style.top = newY + 'px';
            }
            
            function onMouseMove(event) {
                moveAt(event.pageX, event.pageY);
            }
            
            document.addEventListener('mousemove', onMouseMove);
            
            document.addEventListener('mouseup', function onMouseUp(event) {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                
                // Restaurar transición para la rotación
                el.style.transition = 'transform 0.1s'; 
                
                // Guardar coordenadas
                p.x = parseInt(el.style.left);
                p.y = parseInt(el.style.top);
                saveLocalData();
            });
        });
        
        // Desactivar arrastre nativo del navegador
        el.ondragstart = function() { return false; };
    });
}
