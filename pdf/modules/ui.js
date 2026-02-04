let currentMode = 'merge';
let currentFiles = [];
let mergePages = [];
let dragPageIndex = null;
let fileIdCounter = 0;

const fileListEl = document.getElementById('file-list');
const actionBarEl = document.getElementById('action-bar');
const dropzoneEl = document.getElementById('dropzone');
const viewerLoadingEl = document.getElementById('viewer-loading');
const viewerLoadingTextEl = document.getElementById('viewer-loading-text');
const pdfPreviewModalEl = document.getElementById('pdf-preview-modal');
const pdfPreviewTitleEl = document.getElementById('pdf-preview-title');
const pdfPreviewCloseBtn = document.getElementById('pdf-preview-close');
const pdfPreviewLoadingEl = document.getElementById('pdf-preview-loading');
const pdfPreviewLoadingTextEl = document.getElementById('pdf-preview-loading-text');
const pdfPreviewPagesEl = document.getElementById('pdf-preview-pages');

let previewRenderToken = 0;
let previewFileId = null;

function createFileId() {
    fileIdCounter += 1;
    return `file-${fileIdCounter}`;
}

function formatSize(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function buildPagePreviews(bytes) {
    const pageItems = [];

    if (window.pdfjsLib) {
        const loadingTask = window.pdfjsLib.getDocument({ data: bytes.slice(0) });
        const pdfDoc = await loadingTask.promise;

        for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
            const page = await pdfDoc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 0.22 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { alpha: false });

            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));

            await page.render({ canvasContext: context, viewport }).promise;
            pageItems.push({
                pageIndex: pageNumber - 1,
                pageNumber,
                thumbnail: canvas.toDataURL('image/jpeg', 0.82)
            });

            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }

        if (typeof pdfDoc.destroy === 'function') {
            await pdfDoc.destroy();
        }

        return pageItems;
    }

    // Fallback if preview library is unavailable.
    if (window.PDFLib?.PDFDocument) {
        const pdfDoc = await window.PDFLib.PDFDocument.load(bytes);
        const pageCount = pdfDoc.getPageCount();
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
            pageItems.push({
                pageIndex: pageNumber - 1,
                pageNumber,
                thumbnail: ''
            });
        }
        return pageItems;
    }

    throw new Error('PDF preview library is not available.');
}

async function buildMergeFileRecord(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileId = createFileId();
    const previews = await buildPagePreviews(bytes);

    return {
        id: fileId,
        rawFile: file,
        name: file.name,
        size: file.size,
        bytes,
        previews
    };
}

function setPreviewLoading(isLoading, message = 'Loading preview...') {
    if (!pdfPreviewLoadingEl || !pdfPreviewLoadingTextEl) return;
    pdfPreviewLoadingTextEl.textContent = message;
    pdfPreviewLoadingEl.classList.toggle('hidden', !isLoading);
}

function closePdfPreviewModal() {
    previewRenderToken += 1;
    previewFileId = null;

    if (pdfPreviewModalEl) {
        pdfPreviewModalEl.classList.add('hidden');
    }
    if (pdfPreviewPagesEl) {
        pdfPreviewPagesEl.innerHTML = '';
    }

    // Respect split modal lock if it is already open.
    const splitModalOpen = document.getElementById('split-download-modal')?.classList.contains('hidden') === false;
    if (!splitModalOpen) {
        document.body.classList.remove('modal-open');
    }
}

function renderPreviewFromCache(file) {
    const previews = Array.isArray(file?.previews) ? file.previews : [];
    pdfPreviewPagesEl.innerHTML = '';

    if (previews.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'preview-empty';
        emptyEl.textContent = 'No preview available for this file.';
        pdfPreviewPagesEl.appendChild(emptyEl);
        return;
    }

    previews.forEach((preview) => {
        const pageEl = document.createElement('article');
        pageEl.className = 'preview-page-item';
        const labelEl = document.createElement('div');
        labelEl.className = 'preview-page-label';
        labelEl.textContent = `Page ${preview.pageNumber}`;
        pageEl.appendChild(labelEl);

        if (preview.thumbnail) {
            const imgEl = document.createElement('img');
            imgEl.className = 'preview-page-image';
            imgEl.loading = 'lazy';
            imgEl.alt = `${file.name} - page ${preview.pageNumber}`;
            imgEl.src = preview.thumbnail;
            pageEl.appendChild(imgEl);
        } else {
            const fallbackEl = document.createElement('div');
            fallbackEl.className = 'preview-page-fallback';
            fallbackEl.textContent = `Page ${preview.pageNumber}`;
            pageEl.appendChild(fallbackEl);
        }

        pdfPreviewPagesEl.appendChild(pageEl);
    });
}

async function openPdfPreviewModal(file, targetPageNumber = null) {
    if (!pdfPreviewModalEl || !pdfPreviewPagesEl || !pdfPreviewTitleEl) {
        return;
    }

    const localToken = ++previewRenderToken;
    previewFileId = file.id;

    pdfPreviewTitleEl.textContent = targetPageNumber 
        ? `Preview: ${file.name} (Page ${targetPageNumber})`
        : `Preview: ${file.name}`;
    
    pdfPreviewPagesEl.innerHTML = '';
    setPreviewLoading(true, 'Loading preview...');
    pdfPreviewModalEl.classList.remove('hidden');
    document.body.classList.add('modal-open');

    if (!window.pdfjsLib || !file?.bytes) {
        renderPreviewFromCache(file);
        setPreviewLoading(false);
        return;
    }

    const loadingTask = window.pdfjsLib.getDocument({ data: file.bytes.slice(0) });
    let pdfDoc = null;

    try {
        pdfDoc = await loadingTask.promise;
        if (localToken !== previewRenderToken) {
            return;
        }

        const startPage = targetPageNumber || 1;
        const endPage = targetPageNumber || pdfDoc.numPages;

        for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
            if (localToken !== previewRenderToken) {
                return;
            }

            setPreviewLoading(true, targetPageNumber 
                ? `Rendering page ${pageNumber}...` 
                : `Rendering page ${pageNumber}/${pdfDoc.numPages}...`);
                
            const page = await pdfDoc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.3 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { alpha: false });

            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));

            await page.render({ canvasContext: context, viewport }).promise;

            const pageEl = document.createElement('article');
            pageEl.className = 'preview-page-item';
            const labelEl = document.createElement('div');
            labelEl.className = 'preview-page-label';
            labelEl.textContent = `Page ${pageNumber}`;
            pageEl.appendChild(labelEl);
            pageEl.appendChild(canvas);
            pdfPreviewPagesEl.appendChild(pageEl);

            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }
    } finally {
        if (pdfDoc && typeof pdfDoc.destroy === 'function') {
            await pdfDoc.destroy();
        }

        if (localToken === previewRenderToken) {
            setPreviewLoading(false);
        }
    }
}

if (pdfPreviewCloseBtn) {
    pdfPreviewCloseBtn.addEventListener('click', () => {
        closePdfPreviewModal();
    });
}

if (pdfPreviewModalEl) {
    pdfPreviewModalEl.addEventListener('click', (event) => {
        if (event.target === pdfPreviewModalEl) {
            closePdfPreviewModal();
        }
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pdfPreviewModalEl && !pdfPreviewModalEl.classList.contains('hidden')) {
        closePdfPreviewModal();
    }
});

function addFileEntryRow(file, index, containerEl) {
    const cardEl = document.createElement('div');
    cardEl.className = 'file-card';

    const fileInfoEl = document.createElement('div');
    fileInfoEl.className = 'file-info';

    const fileIconEl = document.createElement('i');
    fileIconEl.className = 'fa-solid fa-file-pdf file-icon';

    const fileNameEl = document.createElement('div');
    fileNameEl.className = 'file-name';
    fileNameEl.title = file.name;
    fileNameEl.textContent = file.name;

    const fileSizeEl = document.createElement('div');
    fileSizeEl.className = 'file-size';
    fileSizeEl.textContent = formatSize(file.size);

    fileInfoEl.appendChild(fileIconEl);
    fileInfoEl.appendChild(fileNameEl);
    fileInfoEl.appendChild(fileSizeEl);

    const openPreview = () => {
        openPdfPreviewModal(file).catch((error) => {
            console.error(error);
            alert(error.message || 'Unable to open preview.');
        });
    };

    if (currentMode === 'merge' && file.bytes) {
        cardEl.classList.add('file-card-clickable');
        fileInfoEl.classList.add('file-info-clickable');
        fileInfoEl.setAttribute('role', 'button');
        fileInfoEl.setAttribute('tabindex', '0');
        fileInfoEl.title = 'Open PDF preview';

        fileInfoEl.addEventListener('click', openPreview);
        fileInfoEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPreview();
            }
        });
    }

    const actionsEl = document.createElement('div');
    actionsEl.className = 'file-actions';

    if (currentMode === 'merge' && file.bytes) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'secondary-btn file-preview-btn';
        previewBtn.type = 'button';
        previewBtn.innerHTML = '<i class="fa-solid fa-eye"></i> View';
        previewBtn.addEventListener('click', openPreview);
        actionsEl.appendChild(previewBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove file';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    removeBtn.addEventListener('click', () => {
        removeFile(index);
    });

    actionsEl.appendChild(removeBtn);
    cardEl.appendChild(fileInfoEl);
    cardEl.appendChild(actionsEl);
    containerEl.appendChild(cardEl);
}

function movePage(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const [movedPage] = mergePages.splice(fromIndex, 1);
    mergePages.splice(toIndex, 0, movedPage);
    render();
}

function restorePage(index) {
    if (mergePages[index]) {
        mergePages[index].deleted = false;
        render();
    }
}

function removePage(index) {
    if (mergePages[index]) {
        mergePages[index].deleted = true;
        render();
    }
}

function reorderPageCards(targetIndex) {
    if (dragPageIndex === null || dragPageIndex === targetIndex) {
        return;
    }

    const [movedPage] = mergePages.splice(dragPageIndex, 1);
    let insertAt = targetIndex;
    if (dragPageIndex < targetIndex) {
        insertAt -= 1;
    }
    mergePages.splice(insertAt, 0, movedPage);
    dragPageIndex = null;
    render();
}

function createPageCard(page, index) {
    const cardEl = document.createElement('article');
    cardEl.className = 'page-card';
    if (page.deleted) {
        cardEl.classList.add('page-card-deleted');
    }
    cardEl.draggable = !page.deleted;

    const cardHeader = document.createElement('div');
    cardHeader.className = 'page-card-header';

    const orderEl = document.createElement('div');
    orderEl.className = 'page-order';
    orderEl.textContent = `#${index + 1}`;

    const actionBtn = document.createElement('button');
    if (page.deleted) {
        actionBtn.className = 'page-restore-btn';
        actionBtn.title = 'Restore this page';
        actionBtn.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i>';
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            restorePage(index);
        });
    } else {
        actionBtn.className = 'page-remove-btn';
        actionBtn.title = 'Remove this page';
        actionBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removePage(index);
        });
    }

    cardHeader.appendChild(orderEl);
    cardHeader.appendChild(actionBtn);

    const previewEl = document.createElement(page.thumbnail ? 'img' : 'div');
    previewEl.className = page.thumbnail ? 'page-thumb' : 'page-thumb page-thumb-placeholder';
    if (page.thumbnail) {
        previewEl.src = page.thumbnail;
        previewEl.alt = `${page.fileName} - page ${page.pageNumber}`;
        previewEl.loading = 'lazy';
    } else {
        previewEl.textContent = `Page ${page.pageNumber}`;
    }

    // Individual page preview
    if (!page.deleted) {
        previewEl.style.cursor = 'pointer';
        previewEl.addEventListener('click', () => {
            const file = currentFiles.find(f => f.id === page.fileId);
            if (file) {
                openPdfPreviewModal(file, page.pageNumber).catch(console.error);
            }
        });
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'page-meta';
    const fileNameEl = document.createElement('div');
    fileNameEl.className = 'page-file';
    fileNameEl.title = page.fileName;
    fileNameEl.textContent = page.fileName;
    const labelEl = document.createElement('div');
    labelEl.className = 'page-label';
    labelEl.textContent = `Page ${page.pageNumber}`;
    metaEl.appendChild(fileNameEl);
    metaEl.appendChild(labelEl);

    // Reorder dropdown
    const reorderWrap = document.createElement('div');
    reorderWrap.className = 'page-reorder-select-wrap';
    const reorderLabel = document.createElement('span');
    reorderLabel.textContent = 'Move to:';
    const select = document.createElement('select');
    select.className = 'page-reorder-select';
    select.disabled = page.deleted;
    
    for (let i = 0; i < mergePages.length; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i + 1;
        option.selected = i === index;
        select.appendChild(option);
    }
    
    select.addEventListener('change', (e) => {
        movePage(index, parseInt(e.target.value, 10));
    });

    reorderWrap.appendChild(reorderLabel);
    reorderWrap.appendChild(select);

    cardEl.appendChild(cardHeader);
    cardEl.appendChild(previewEl);
    cardEl.appendChild(metaEl);
    cardEl.appendChild(reorderWrap);

    if (!page.deleted) {
        cardEl.addEventListener('dragstart', () => {
            dragPageIndex = index;
            cardEl.classList.add('dragging');
        });

        cardEl.addEventListener('dragover', (event) => {
            event.preventDefault();
            cardEl.classList.add('drag-over');
        });

        cardEl.addEventListener('dragleave', () => {
            cardEl.classList.remove('drag-over');
        });

        cardEl.addEventListener('drop', (event) => {
            event.preventDefault();
            cardEl.classList.remove('drag-over');
            reorderPageCards(index);
        });

        cardEl.addEventListener('dragend', () => {
            dragPageIndex = null;
            cardEl.classList.remove('dragging');
        });
    }

    return cardEl;
}

function renderMergeView() {
    fileListEl.innerHTML = '';

    const filesWrapEl = document.createElement('div');
    filesWrapEl.className = 'merge-file-list';
    currentFiles.forEach((file, index) => addFileEntryRow(file, index, filesWrapEl));
    fileListEl.appendChild(filesWrapEl);

    const hintEl = document.createElement('p');
    hintEl.className = 'merge-hint';
    hintEl.textContent = 'Click a file above to open full preview, then drag page cards to set exact merge order.';
    fileListEl.appendChild(hintEl);

    const pageGridEl = document.createElement('div');
    pageGridEl.className = 'page-grid';
    mergePages.forEach((page, index) => {
        pageGridEl.appendChild(createPageCard(page, index));
    });
    fileListEl.appendChild(pageGridEl);
}

function renderSplitView() {
    fileListEl.innerHTML = '';
    currentFiles.forEach((file, index) => addFileEntryRow(file, index, fileListEl));
}

function render() {
    if (currentFiles.length === 0) {
        fileListEl.classList.add('hidden');
        actionBarEl.classList.add('hidden');
        dropzoneEl.style.display = 'flex';
        return;
    }

    fileListEl.classList.remove('hidden');
    actionBarEl.classList.remove('hidden');
    dropzoneEl.style.display = 'flex';

    if (currentMode === 'merge') {
        renderMergeView();
        return;
    }

    renderSplitView();
}

export function setUIMode(mode) {
    currentMode = mode;
    if (mode !== 'merge') {
        closePdfPreviewModal();
    }
    render();
}

export function setLoadingState(isLoading, message = 'Loading PDF pages...') {
    if (!viewerLoadingEl || !viewerLoadingTextEl) return;

    viewerLoadingTextEl.textContent = message;
    viewerLoadingEl.classList.toggle('hidden', !isLoading);
    dropzoneEl.classList.toggle('is-loading', isLoading);
}

export async function updateFileList(newFiles, onProgress) {
    const progressHandler = typeof onProgress === 'function' ? onProgress : null;

    if (currentMode === 'merge') {
        const preparedFiles = [];
        for (let index = 0; index < newFiles.length; index += 1) {
            const file = newFiles[index];
            if (progressHandler) {
                progressHandler({ index, total: newFiles.length, fileName: file.name });
            }
            preparedFiles.push(await buildMergeFileRecord(file));
        }

        currentFiles = [...currentFiles, ...preparedFiles];
        preparedFiles.forEach((file) => {
            file.previews.forEach((preview) => {
                mergePages.push({
                    id: `${file.id}-p${preview.pageNumber}`,
                    fileId: file.id,
                    fileName: file.name,
                    pageIndex: preview.pageIndex,
                    pageNumber: preview.pageNumber,
                    thumbnail: preview.thumbnail,
                    deleted: false
                });
            });
        });

        render();
        return;
    }

    const splitRecords = Array.from(newFiles).map((file) => ({
        id: createFileId(),
        rawFile: file,
        name: file.name,
        size: file.size
    }));

    currentFiles = [...currentFiles, ...splitRecords];
    render();
}

export function getFiles() {
    return currentFiles.map((file) => file.rawFile);
}

export function getMergeSelection() {
    if (currentMode !== 'merge') {
        return { files: [], pages: [] };
    }

    return {
        files: currentFiles.map((file) => ({
            id: file.id,
            name: file.name,
            bytes: file.bytes
        })),
        pages: mergePages
            .filter(page => !page.deleted)
            .map((page) => ({
                fileId: page.fileId,
                pageIndex: page.pageIndex
            }))
    };
}

export function clearFiles() {
    currentFiles = [];
    mergePages = [];
    dragPageIndex = null;
    closePdfPreviewModal();
    render();
}

export function removeFile(index) {
    const [removedFile] = currentFiles.splice(index, 1);

    if (currentMode === 'merge' && removedFile) {
        mergePages = mergePages.filter((page) => page.fileId !== removedFile.id);
        if (previewFileId === removedFile.id) {
            closePdfPreviewModal();
        }
    }

    render();
}
