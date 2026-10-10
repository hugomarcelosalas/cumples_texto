document.addEventListener('DOMContentLoaded', async () => {
    const center = document.querySelector('.content-center');
    const STORAGE_KEY = 'cumples_texto_local_state_v5';
    const IMAGE_DB_NAME = 'cumples_texto_storage_v2';
    const IMAGE_STORE_NAME = 'confirmation_images';
    const STATE_STORE_NAME = 'app_state';
    let restoringState = false;
    let saveTimer = null;

    function openImageDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('IndexedDB no disponible'));
            const request = indexedDB.open(IMAGE_DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) db.createObjectStore(IMAGE_STORE_NAME);
                if (!db.objectStoreNames.contains(STATE_STORE_NAME)) db.createObjectStore(STATE_STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
        });
    }

    async function saveConfirmationImage(lang, blob) {
        const db = await openImageDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
            tx.objectStore(IMAGE_STORE_NAME).put(blob, `confirmation-${lang}`);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    }

    async function loadConfirmationImage(lang) {
        const db = await openImageDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGE_STORE_NAME, 'readonly');
            const request = tx.objectStore(IMAGE_STORE_NAME).get(`confirmation-${lang}`);
            request.onsuccess = () => { const value = request.result || null; db.close(); resolve(value); };
            request.onerror = () => { db.close(); reject(request.error); };
        });
    }

    async function deleteConfirmationImage(lang) {
        try {
            const db = await openImageDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
                tx.objectStore(IMAGE_STORE_NAME).delete(`confirmation-${lang}`);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        } catch (err) {
            console.warn('No se pudo eliminar la imagen guardada:', err);
        }
    }

    function renderConfirmationImage(area, blob, lang) {
        if (!area) return;
        const preview = area.querySelector('.confirmation-image-preview');
        if (!preview) return;
        preview.innerHTML = '';
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Imagen cargada';
        img.className = 'preview-img';
        preview.appendChild(img);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-action confirmation-image-delete';
        remove.title = 'Eliminar imagen';
        remove.innerHTML = '<i class="fa-solid fa-trash"></i> Eliminar imagen';
        remove.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();
            await deleteConfirmationImage(lang);
            preview.innerHTML = '';
            const input = area.querySelector('.confirmation-image-input');
            if (input) input.value = '';
            showToast('Imagen eliminada.');
        });
        preview.appendChild(remove);
    }

    async function restoreConfirmationImages() {
        for (const lang of ['es', 'en']) {
            const area = document.querySelector(`#block-${lang === 'es' ? 'confirmacion' : 'confirmation'}-${lang} .confirmation-image-area`);
            if (!area) continue;
            try {
                const blob = await loadConfirmationImage(lang);
                if (blob) renderConfirmationImage(area, blob, lang);
            } catch (err) {
                console.warn(`No se pudo restaurar la imagen ${lang}:`, err);
            }
        }
    }

    function scheduleSave() {
        if (restoringState) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveState, 120);
    }

    async function saveState() {
        if (restoringState) return;
        try {
            const cleanHTML = element => {
                if (!element) return '';
                const clone = element.cloneNode(true);
                clone.querySelectorAll('[data-wired]').forEach(el => el.removeAttribute('data-wired'));
                clone.querySelectorAll('.sub-block-tabs').forEach(el => el.remove());
                clone.querySelectorAll('.sub-block.tab-hidden').forEach(el => el.classList.remove('tab-hidden'));
                clone.querySelectorAll('.confirmation-image-preview img, .confirmation-image-delete, .generated-delete').forEach(el => el.remove());
                return clone.innerHTML;
            };
            const state = {
                version: 2,
                leftMarkers: cleanHTML(document.querySelector('.left-sidebar .marker-list')),
                rightMarkers: cleanHTML(document.querySelector('.right-sidebar .marker-list')),
                content: cleanHTML(center),
                activeTarget: document.querySelector('.marker-item.active')?.dataset.target || null,
                formValues: {}
            };

            document.querySelectorAll('input, select, textarea').forEach((el, i) => {
                if (el.type === 'file') return;
                const key = el.id || el.name || `field-${i}`;
                if (el.type === 'radio' || el.type === 'checkbox') {
                    state.formValues[key] = { type: el.type, checked: el.checked };
                } else {
                    state.formValues[key] = { type: el.type, value: el.value };
                }
            });

            const db = await openImageDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STATE_STORE_NAME, 'readwrite');
                tx.objectStore(STATE_STORE_NAME).put(state, 'current');
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el estado'));
            });
            db.close();
        } catch (err) {
            console.warn('No se pudieron guardar los cambios localmente:', err);
            // Do not use localStorage for the app state: images and HTML can exceed its quota.
        }
    }

    async function restoreState() {
        try {
            const db = await openImageDB();
            const state = await new Promise((resolve, reject) => {
                const tx = db.transaction(STATE_STORE_NAME, 'readonly');
                const request = tx.objectStore(STATE_STORE_NAME).get('current');
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
            db.close();
            return state;
        } catch (err) {
            console.warn('No se pudo recuperar el estado local; se mantiene el contenido inicial.', err);
            return null;
        }
    }

    function restoreFormValues(formValues = {}) {
        Object.entries(formValues).forEach(([key, data]) => {
            const el = document.getElementById(key) || document.querySelector(`[name="${CSS.escape(key)}"]`);
            if (!el) return;
            if (data.type === 'radio' || data.type === 'checkbox') el.checked = !!data.checked;
            else if (typeof data.value === 'string') el.value = data.value;
        });
    }

    async function loadSavedState() {
        const state = await restoreState();
        if (!state) return null;
        restoringState = true;
        try {
            const leftList = document.querySelector('.left-sidebar .marker-list');
            const rightList = document.querySelector('.right-sidebar .marker-list');
            if (leftList && typeof state.leftMarkers === 'string') leftList.innerHTML = state.leftMarkers;
            if (rightList && typeof state.rightMarkers === 'string') rightList.innerHTML = state.rightMarkers;
            if (center && typeof state.content === 'string') center.innerHTML = state.content;
        } finally {
            restoringState = false;
        }
        return state;
    }

    async function clearSavedState() {
        try {
            const db = await openImageDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction([STATE_STORE_NAME, IMAGE_STORE_NAME], 'readwrite');
                tx.objectStore(STATE_STORE_NAME).delete('current');
                tx.objectStore(IMAGE_STORE_NAME).delete('confirmation-es');
                tx.objectStore(IMAGE_STORE_NAME).delete('confirmation-en');
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        } catch (err) { console.warn('No se pudieron borrar los datos locales:', err); }
        showToast('Cambios locales eliminados. Recargando contenido original...');
        setTimeout(() => window.location.reload(), 500);
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function activateMarker(item) {
        if (!item) return;
        document.querySelectorAll('.marker-item').forEach(m => m.classList.remove('active'));
        document.querySelectorAll('.content-block').forEach(b => b.classList.remove('active'));
        item.classList.add('active');
        const target = document.getElementById(`block-${item.dataset.target}`);
        if (target) target.classList.add('active');
    }

    function wireMarker(item) {
        if (item.dataset.wired === 'true') return;
        item.dataset.wired = 'true';
        item.addEventListener('click', e => {
            if (e.target.closest('.marker-delete')) return;
            activateMarker(item);
        });
    }

    function addMarkerDeleteButton(item) {
        if (item.querySelector('.marker-delete')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'marker-delete';
        btn.title = 'Eliminar marcador';
        btn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const targetId = item.dataset.target;
            if (!confirm('¿Eliminar este marcador y todos sus bloques?')) return;
            item.remove();
            document.getElementById(`block-${targetId}`)?.remove();
            const first = document.querySelector('.marker-item');
            if (first) activateMarker(first);
            scheduleSave();
        });
        item.appendChild(btn);
    }

    const savedState = await loadSavedState();

    document.querySelectorAll('.marker-item').forEach(item => {
        wireMarker(item);
        addMarkerDeleteButton(item);
    });

    function getPlainTextPreservingLayout(root) {
        const blockTags = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION']);
        const lines = [];
        let current = '';

        const pushLine = () => {
            const value = current.replace(/[ \t]+/g, ' ').trim();
            if (value || lines.length) lines.push(value);
            current = '';
        };

        const walk = node => {
            if (node.nodeType === Node.TEXT_NODE) {
                current += node.nodeValue || '';
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName;
            if (tag === 'BR') {
                pushLine();
                return;
            }
            if (tag === 'IMG') return;

            const isBlock = blockTags.has(tag);
            if (isBlock && tag === 'LI') current += '• ';
            node.childNodes.forEach(walk);
            if (isBlock) pushLine();
        };

        root.childNodes.forEach(walk);
        if (current.trim()) pushLine();

        // Remove accidental duplicate blank lines while preserving intentional paragraph spacing.
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    function getImageElement(subBlock) {
        return subBlock.querySelector('.editable-area img, img.preview-img');
    }

    function getImageBlob(img) {
        return new Promise((resolve, reject) => {
            if (!img) return reject(new Error('No image found'));
            const canvas = document.createElement('canvas');
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (!width || !height) return reject(new Error('Image is not loaded'));
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas unavailable'));
            try {
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create image blob')), 'image/png');
            } catch (err) {
                reject(err);
            }
        });
    }

    function copyTextFallback(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    function copyImageFallback(img) {
        // Legacy browsers cannot place a real image on the clipboard.
        // Select the visible image so the user can still use the browser's image-copy action.
        const range = document.createRange();
        range.selectNode(img);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
    }

    function copyContentFromBlock(subBlock) {
        const clone = subBlock.cloneNode(true);
        clone.querySelectorAll('.sub-block-header, .btn-action, .block-controls, .image-upload-label, input, .marker-delete').forEach(el => el.remove());
        const image = clone.querySelector('img');
        const editable = clone.querySelector('.editable-area') || clone;
        const text = getPlainTextPreservingLayout(editable);
        return { text, hasImage: !!image, imageSrc: image?.currentSrc || image?.src || '' };
    }

    async function copyBlock(subBlock) {
        const content = copyContentFromBlock(subBlock);
        const image = getImageElement(subBlock);

        // Image-only blocks: copy the actual image to the clipboard, never the data URL.
        if (image && !content.text) {
            try {
                const blob = await getImageBlob(image);
                if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                    showToast('Imagen copiada. Ya puedes pegarla.');
                    return;
                }
                copyImageFallback(image);
                showToast('Imagen copiada. Ya puedes pegarla.');
                return;
            } catch (err) {
                console.warn('No se pudo copiar la imagen directamente:', err);
                copyImageFallback(image);
                showToast('Imagen copiada. Ya puedes pegarla.');
                return;
            }
        }

        // Text blocks: preserve the visible line order and paragraph breaks.
        try {
            await navigator.clipboard.writeText(content.text);
        } catch (err) {
            copyTextFallback(content.text);
        }
        showToast('Contenido del bloque copiado.');
    }

    function makeBlock(title, content = '') {
        const sub = document.createElement('div');
        sub.className = 'sub-block copyable-sub-block';
        sub.innerHTML = `
            <div class="sub-block-header">
                <h4>${escapeHtml(title)}</h4>
                <div class="sub-block-actions">
                    <button class="btn-action btn-copy-sub" type="button" title="Copiar contenido"><i class="fa-solid fa-copy"></i></button>
                    <button class="btn-action btn-edit-sub" type="button" title="Editar bloque"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-action btn-delete-sub" type="button" title="Eliminar bloque"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="editable-area" contenteditable="false">${content}</div>`;
        return sub;
    }

    function renumberBlocks(blockBody) {
        blockBody.querySelectorAll(':scope > .sub-block').forEach((sub, i) => {
            const h = sub.querySelector(':scope > .sub-block-header h4');
            if (h && /^Bloque \d+$/.test(h.textContent.trim())) h.textContent = `Bloque ${i + 1}`;
            if (h && /^Block \d+$/.test(h.textContent.trim())) h.textContent = `Block ${i + 1}`;
        });
    }

    function ensureBlockControls(blockBody) {
        let controls = blockBody.querySelector(':scope > .block-controls');
        if (!controls) {
            controls = document.createElement('div');
            controls.className = 'block-controls';
            blockBody.appendChild(controls);
        }
        if (!controls.querySelector('.btn-add-block')) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn-primary btn-add-block';
            b.textContent = blockBody.closest('.content-block')?.id?.includes('en') ? '＋ Add block' : '＋ Añadir bloque';
            controls.appendChild(b);
        }
    }

    function refreshBlockTabs(body, preferredIndex) {
        if (!body) return;
        const blocks = Array.from(body.querySelectorAll(':scope > .sub-block'));
        let tabs = body.querySelector(':scope > .sub-block-tabs');
        if (!tabs && blocks.length) {
            tabs = document.createElement('div');
            tabs.className = 'sub-block-tabs';
            tabs.setAttribute('role', 'tablist');
            body.insertBefore(tabs, blocks[0]);
        }
        if (!tabs) return;
        if (!blocks.length) {
            tabs.remove();
            return;
        }
        const isEn = body.closest('.content-block')?.id?.includes('-en');
        const previous = Number.isInteger(preferredIndex) ? preferredIndex : Number(tabs.dataset.activeIndex || 0);
        const activeIndex = Math.max(0, Math.min(previous, blocks.length - 1));
        tabs.dataset.activeIndex = String(activeIndex);
        tabs.innerHTML = '';
        blocks.forEach((block, index) => {
            block.classList.toggle('tab-hidden', index !== activeIndex);
            const heading = block.querySelector(':scope > .sub-block-header h4');
            const label = heading?.textContent.trim() || (isEn ? `Block ${index + 1}` : `Bloque ${index + 1}`);
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'sub-block-tab' + (index === activeIndex ? ' active' : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(index === activeIndex));
            tab.textContent = label;
            tab.addEventListener('click', () => refreshBlockTabs(body, index));
            tabs.appendChild(tab);
        });
    }

    function wireBlock(sub) {
        if (sub.dataset.wired === 'true') return;
        sub.dataset.wired = 'true';
        const copyButton = sub.querySelector('.btn-copy-sub');
        if (copyButton) {
            const isEn = sub.closest('.content-block')?.id?.includes('-en');
            copyButton.classList.add('btn-copy-block');
            copyButton.innerHTML = '<i class="fa-solid fa-copy"></i><span>' + (isEn ? 'Copy block' : 'Copiar bloque') + '</span>';
            copyButton.type = 'button';
            copyButton.addEventListener('click', e => {
                e.stopPropagation();
                copyBlock(sub);
            });
        }
        sub.querySelector('.btn-edit-sub')?.addEventListener('click', e => {
            e.stopPropagation();
            const area = sub.querySelector('.editable-area');
            if (!area) return;
            const editing = area.getAttribute('contenteditable') === 'true';
            area.setAttribute('contenteditable', editing ? 'false' : 'true');
            sub.classList.toggle('editing', !editing);
            e.currentTarget.innerHTML = editing ? '<i class="fa-solid fa-pen"></i>' : '<i class="fa-solid fa-check"></i>';
            if (!editing) area.focus();
        });
        sub.querySelector('.btn-delete-sub')?.addEventListener('click', e => {
            e.stopPropagation();
            const body = sub.parentElement;
            if (!confirm('¿Eliminar este bloque?')) return;
            const bodyIndex = Array.from(body.querySelectorAll(':scope > .sub-block')).indexOf(sub);
            sub.remove();
            renumberBlocks(body);
            refreshBlockTabs(body, Math.max(0, bodyIndex - 1));
            scheduleSave();
        });
    }

    function wireBlockBody(body) {
        body.querySelectorAll(':scope > .sub-block').forEach(wireBlock);
        refreshBlockTabs(body);
        ensureBlockControls(body);
        const add = body.querySelector(':scope > .block-controls .btn-add-block');
        if (add && add.dataset.wired !== 'true') {
            add.dataset.wired = 'true';
            add.addEventListener('click', () => {
                const block = document.createElement('div');
                block.className = 'sub-block copyable-sub-block';
                const isEn = body.closest('.content-block')?.id?.includes('en');
                const title = isEn ? `Block ${body.querySelectorAll(':scope > .sub-block').length + 1}` : `Bloque ${body.querySelectorAll(':scope > .sub-block').length + 1}`;
                block.innerHTML = `<div class="sub-block-header"><h4>${title}</h4><div class="sub-block-actions"><button class="btn-action btn-copy-sub" type="button" title="Copiar contenido"><i class="fa-solid fa-copy"></i></button><button class="btn-action btn-edit-sub" type="button" title="Editar bloque"><i class="fa-solid fa-pen"></i></button><button class="btn-action btn-delete-sub" type="button" title="Eliminar bloque"><i class="fa-solid fa-trash"></i></button></div></div><div class="editable-area" contenteditable="true"></div>`;
                body.insertBefore(block, body.querySelector(':scope > .block-controls'));
                wireBlock(block);
                refreshBlockTabs(body, body.querySelectorAll(':scope > .sub-block').length - 1);
                block.querySelector('.editable-area')?.focus();
                scheduleSave();
            });
        }
    }

    document.querySelectorAll('.block-body').forEach(wireBlockBody);

    // Add/remove marker controls on both sidebars.
    document.querySelectorAll('.btn-add-marker').forEach(btn => {
        btn.addEventListener('click', () => {
            const side = btn.dataset.side;
            const sidebar = side === 'left' ? document.querySelector('.left-sidebar') : document.querySelector('.right-sidebar');
            const list = sidebar.querySelector('.marker-list');
            const name = prompt(side === 'left' ? 'Nombre del nuevo marcador:' : 'Name of the new marker:');
            if (!name?.trim()) return;
            const id = `custom-${side}-${Date.now()}`;
            const item = document.createElement('li');
            item.className = 'marker-item';
            item.dataset.side = side;
            item.dataset.target = id;
            item.dataset.markerId = id;
            item.innerHTML = `<i class="fa-solid fa-bookmark"></i><span class="marker-label">${escapeHtml(name.trim())}</span>`;
            list.appendChild(item);
            wireMarker(item);
            addMarkerDeleteButton(item);

            const block = document.createElement('div');
            block.className = 'content-block';
            block.id = `block-${id}`;
            block.innerHTML = `<div class="block-header"><h2>${escapeHtml(name.trim())}</h2><div class="block-actions"><button class="btn-action btn-edit" type="button" title="Editar contenido"><i class="fa-solid fa-pen"></i></button></div></div><div class="block-body block-list-body"></div>`;
            center.appendChild(block);
            const body = block.querySelector('.block-body');
            body.appendChild(makeBlock(side === 'left' ? 'Bloque 1' : 'Block 1'));
            wireBlockBody(body);
            activateMarker(item);
            scheduleSave();
        });
    });

    // Generator: keep exactly ONE generated message in Block 1.
    function setupGenerator(lang) {
        const btn = document.getElementById(`btn-generar-${lang}`);
        const target = document.getElementById(`msg-container-${lang}`);
        if (!btn || !target) return;

        const defaultText = lang === 'es'
            ? 'Rellena el formulario y pulsa «Generar Mensaje Automático».'
            : 'Fill in the form and click “Generate Automatic Message”.';

        function ensureGeneratedUI() {
            let output = target.querySelector('.generated-output');
            if (!output) {
                output = document.createElement('p');
                output.className = 'generated-output';
                output.textContent = defaultText;
                const header = target.querySelector('.sub-block-header');
                if (header) target.insertBefore(output, header.nextSibling);
                else target.prepend(output);
            }

            let deleteBtn = target.querySelector('.generated-delete');
            if (!deleteBtn) {
                deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-action generated-delete';
                deleteBtn.title = lang === 'es' ? 'Borrar texto generado' : 'Delete generated text';
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i> ' + (lang === 'es' ? 'Borrar texto' : 'Delete text');
                const header = target.querySelector('.sub-block-header');
                const actions = header?.querySelector('.sub-block-actions');
                if (actions) actions.appendChild(deleteBtn);
                else target.appendChild(deleteBtn);

                deleteBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const current = target.querySelector('.generated-output');
                    if (current) {
                        current.innerHTML = '';
                        current.textContent = defaultText;
                    }
                    showToast(lang === 'es' ? 'Texto generado eliminado.' : 'Generated text deleted.');
                    scheduleSave();
                });
            }
            return output;
        }

        // If a saved state already contains a generated message, restore its delete button.
        ensureGeneratedUI();

        btn.addEventListener('click', () => {
            const nombre = document.getElementById(`nombre-${lang}`)?.value.trim() || 'Cumpleañero/a';
            const fechaInput = document.getElementById(`dia-${lang}`)?.value;
            const horaInicioStr = document.getElementById(`hora-${lang}`)?.value;
            const modo = document.querySelector(`input[name="modo-${lang}"]:checked`)?.value || 'X';
            if (!fechaInput || !horaInicioStr) {
                alert(lang === 'es' ? 'Por favor selecciona el día y la hora de inicio.' : 'Please select the date and start time.');
                return;
            }
            const [, month, day] = fechaInput.split('-');
            const fecha = `${day}/${month}`;
            const [h, m] = horaInicioStr.split(':').map(Number);
            const arrival = h * 60 + m - 15;
            const duration = modo === 'X' ? 60 : 120;
            const end = h * 60 + m + duration;
            const departure = end + 45;
            const fmt = total => `${String(Math.floor((total + 1440) % 1440 / 60)).padStart(2, '0')}:${String((total + 1440) % 60).padStart(2, '0')}`;
            const llegada = fmt(arrival), salto = `${horaInicioStr} a ${fmt(end)}`, salida = fmt(departure);
            const lines = lang === 'es' ? [
                `¡Hola! Te escribimos desde CostaJump San Pedro para confirmar los detalles del cumpleaños de *${nombre}* 🥳`,
                'Por favor, necesitamos que nos confirmes lo siguiente:',
                '- Cantidad de niños que asistirán (un número aproximado está bien)',
                '- Menú para los niños: debe ser el mismo para todos.',
                'Puedes elegir entre:',
                '🍕 Pizza (3 porciones por niño)',
                '🌭 Hot Dogs (1 por niño)',
                '',
                'Recordatorio:',
                `📅 Día: *${fecha}*`,
                `🕓 Hora de llegada: *${llegada}*`,
                `🕕 Hora de salto: *${salto}*`,
                `🕗 Hora de salida: *${salida}*`
            ] : [
                `Hello! We are writing from CostaJump San Pedro to confirm the birthday details of *${nombre}* 🥳`,
                'Please confirm the following:',
                '- Number of attending children (approximate is fine)',
                '- Kids menu: must be the same for everyone.',
                'Choose between:',
                '🍕 Pizza (3 slices per child)',
                '🌭 Hot Dogs (1 per child)',
                '',
                'Friendly reminder:',
                `📅 Date: *${fecha}*`,
                `🕓 Arrival time: *${llegada}*`,
                `🕕 Jump time: *${salto}*`,
                `🕗 Departure time: *${salida}*`
            ];

            // Remove any old generated output(s) before creating the new one.
            target.querySelectorAll('.generated-output').forEach(el => el.remove());
            const output = document.createElement('div');
            output.className = 'generated-output';
            output.innerHTML = lines.map(line => `<div>${escapeHtml(line) || '&nbsp;'}</div>`).join('');
            const header = target.querySelector('.sub-block-header');
            if (header) target.insertBefore(output, header.nextSibling);
            else target.prepend(output);

            // Keep exactly one delete button.
            target.querySelectorAll('.generated-delete').forEach((el, i) => { if (i > 0) el.remove(); });
            ensureGeneratedUI();

            showToast(lang === 'es' ? '¡Mensaje generado con éxito!' : 'Message successfully generated!');
            scheduleSave();
        });
    }
    setupGenerator('es');
    setupGenerator('en');

    // Image upload for confirmation/confirmation Block 2. Images are stored in IndexedDB
    // so they survive reloads and do not consume localStorage quota.
    document.querySelectorAll('.confirmation-image-input').forEach(input => {
        input.addEventListener('change', async event => {
            const file = event.target.files?.[0];
            if (!file || !file.type.startsWith('image/')) return;
            const area = input.closest('.confirmation-image-area');
            const lang = input.closest('[id^="block-confirmacion-"]') ? 'es' : 'en';
            try {
                await saveConfirmationImage(lang, file);
                renderConfirmationImage(area, file, lang);
                showToast('Imagen guardada. Permanecerá después de actualizar.');
            } catch (err) {
                console.error('No se pudo guardar la imagen:', err);
                showToast('No se pudo guardar la imagen.');
            }
        });
    });

    // Section pencil remains for legacy sections, but there is intentionally NO section copy button.
    document.querySelectorAll('.btn-edit').forEach(btn => {
        if (btn.dataset.wired === 'true') return;
        btn.dataset.wired = 'true';
        btn.addEventListener('click', () => {
            const block = btn.closest('.content-block');
            const areas = block.querySelectorAll('.editable-area');
            const editing = btn.classList.contains('editing');
            if (!editing) {
                btn.classList.add('editing');
                areas.forEach(a => a.setAttribute('contenteditable', 'true'));
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
            } else {
                btn.classList.remove('editing');
                areas.forEach(a => a.setAttribute('contenteditable', 'false'));
                btn.innerHTML = '<i class="fa-solid fa-pen"></i>';
                showToast('Cambios guardados.');
                scheduleSave();
            }
        });
    });

    if (savedState) {
        restoreFormValues(savedState.formValues);
        const savedMarker = savedState.activeTarget ? document.querySelector(`.marker-item[data-target="${CSS.escape(savedState.activeTarget)}"]`) : null;
        const firstMarker = savedMarker || document.querySelector('.marker-item');
        if (firstMarker) activateMarker(firstMarker);
    }

    // Restore uploaded confirmation images independently from localStorage.
    restoreConfirmationImages();

    // Persist all manual edits (text, selects, checkboxes, generated messages, etc.).
    document.addEventListener('input', scheduleSave);
    document.addEventListener('change', scheduleSave);
    document.addEventListener('click', event => {
        if (event.target.closest('.btn-copy-sub')) return;
        if (event.target.closest('.marker-item')) {
            setTimeout(scheduleSave, 0);
        }
    });

    // Allow the user to reset local changes without touching the original files.
    // Use from the browser console: window.resetCumplesTextoLocal()
    window.resetCumplesTextoLocal = clearSavedState;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
});
