document.addEventListener('DOMContentLoaded', () => {
    const center = document.querySelector('.content-center');
    const STORAGE_KEY = 'cumples_texto_local_state_v2';
    let restoringState = false;
    let saveTimer = null;

    function scheduleSave() {
        if (restoringState) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveState, 120);
    }

    function saveState() {
        if (restoringState) return;
        try {
            const cleanHTML = element => {
                if (!element) return '';
                const clone = element.cloneNode(true);
                clone.querySelectorAll('[data-wired]').forEach(el => el.removeAttribute('data-wired'));
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

            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err) {
            console.warn('No se pudieron guardar los cambios localmente:', err);
            showToast('No se pudo guardar el cambio. Puede que el almacenamiento local esté lleno.');
        }
    }

    function restoreState() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.warn('Estado local corrupto; se mantiene el contenido inicial.', err);
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

    function loadSavedState() {
        const state = restoreState();
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

    function clearSavedState() {
        localStorage.removeItem(STORAGE_KEY);
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

    const savedState = loadSavedState();

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

    function wireBlock(sub) {
        if (sub.dataset.wired === 'true') return;
        sub.dataset.wired = 'true';
        sub.querySelector('.btn-copy-sub')?.addEventListener('click', e => {
            e.stopPropagation();
            copyBlock(sub);
        });
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
            sub.remove();
            renumberBlocks(body);
            scheduleSave();
        });
    }

    function wireBlockBody(body) {
        body.querySelectorAll(':scope > .sub-block').forEach(wireBlock);
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

    // Generator: keep the generated message inside Block 1 only.
    function setupGenerator(lang) {
        const btn = document.getElementById(`btn-generar-${lang}`);
        if (!btn) return;
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
            const target = document.getElementById(`msg-container-${lang}`);
            if (!target) return;
            const output = target.querySelector('.generated-output');
            if (output) {
                output.innerHTML = lines.map(line => `<div>${escapeHtml(line) || '&nbsp;'}</div>`).join('');
            } else {
                const editableArea = target.querySelector('.editable-area');
                if (editableArea) editableArea.innerHTML = lines.map(line => `<div>${escapeHtml(line) || '&nbsp;'}</div>`).join('');
            }
            showToast(lang === 'es' ? '¡Mensaje generado con éxito!' : 'Message successfully generated!');
            scheduleSave();
        });
    }
    setupGenerator('es');
    setupGenerator('en');

    // Image upload for confirmation block 2.
    document.querySelectorAll('.confirmation-image-input').forEach(input => {
        input.addEventListener('change', event => {
            const file = event.target.files?.[0];
            if (!file || !file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = e => {
                const area = input.closest('.confirmation-image-area');
                const originalData = e.target.result;
                const finish = data => {
                    area.querySelector('.confirmation-image-preview').innerHTML = `<img src="${data}" alt="Imagen cargada" class="preview-img">`;
                    scheduleSave();
                };

                // Keep uploaded images locally while avoiding unnecessary localStorage bloat.
                if (typeof originalData === 'string' && originalData.length > 1800000 && /^data:image\/(png|jpeg|jpg|webp)$/i.test(originalData)) {
                    const img = new Image();
                    img.onload = () => {
                        const maxSize = 1600;
                        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        finish(canvas.toDataURL('image/jpeg', 0.82));
                    };
                    img.src = originalData;
                } else {
                    finish(originalData);
                }
            };
            reader.readAsDataURL(file);
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
