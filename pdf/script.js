import { mergePDFPages, splitPDF, addTextToPDF } from './modules/pdf_ops.js';
import { applyRedactions } from './modules/redact.js';
import { updateFileList, getFiles, clearFiles, getMergeSelection, getRedactionData, clearRedactionAreas, setLoadingState, setUIMode, updateSplitSelectionFromInput, getTypeData, clearTypeData } from './modules/ui.js';

document.addEventListener('DOMContentLoaded', () => {
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    }
    
    // --- UI Elements ---
    const dropzone = document.getElementById('dropzone');
    const dropzoneTitle = document.getElementById('dropzone-title');
    const dropzoneSubtitle = document.getElementById('dropzone-subtitle');
    const fileInput = document.getElementById('file-input');
    const processBtn = document.getElementById('process-btn');
    const clearBtn = document.getElementById('clear-all-btn');
    const themeBtn = document.getElementById('theme-toggle');
    const currentToolTitle = document.getElementById('current-tool-title');
    const currentToolDesc = document.getElementById('current-tool-desc');
    const splitOptions = document.getElementById('split-options');
    const splitRangesInput = document.getElementById('split-ranges-input');
    const mergeOptions = document.getElementById('merge-options');
    const mergeFilenameInput = document.getElementById('merge-filename');
    const toolButtons = Array.from(document.querySelectorAll('.tool-btn[data-tool]'));
    const redactOptions = document.getElementById('redact-options');
    const typeOptions = document.getElementById('type-options');
    const splitDownloadModal = document.getElementById('split-download-modal');
    const splitZipBtn = document.getElementById('split-zip-btn');
    const splitAllBtn = document.getElementById('split-all-btn');
    const splitCancelBtn = document.getElementById('split-cancel-btn');

    const toolConfig = {
        merge: {
            title: 'Merge PDFs',
            description: 'Combine multiple PDF files into one.',
            dropzoneTitle: 'Drop PDFs here',
            dropzoneSubtitle: 'or click to select files',
            processLabel: '<i class="fa-solid fa-gear"></i> Merge Files',
            multiple: true,
            showSplitOptions: false,
            showMergeOptions: true,
            showRedactOptions: false,
            showTypeOptions: false
        },
        split: {
            title: 'Split PDF',
            description: 'Split one PDF into separate files by ranges.',
            dropzoneTitle: 'Drop one PDF here',
            dropzoneSubtitle: 'or click to select a file',
            processLabel: '<i class="fa-solid fa-gear"></i> Split File',
            multiple: false,
            showSplitOptions: true,
            showMergeOptions: false,
            showRedactOptions: false,
            showTypeOptions: false
        },
        redact: {
            title: 'Redact PDF',
            description: 'Permanently remove sensitive content from PDFs.',
            dropzoneTitle: 'Drop one PDF here',
            dropzoneSubtitle: 'or click to select a file',
            processLabel: '<i class="fa-solid fa-shield-halved"></i> Apply Redactions',
            multiple: false,
            showSplitOptions: false,
            showMergeOptions: false,
            showRedactOptions: true,
            showTypeOptions: false
        },
        type: {
            title: 'Type on PDF',
            description: 'Add text to your PDF documents.',
            dropzoneTitle: 'Drop one PDF here',
            dropzoneSubtitle: 'or click to select a file',
            processLabel: '<i class="fa-solid fa-i-cursor"></i> Save PDF',
            multiple: false,
            showSplitOptions: false,
            showMergeOptions: false,
            showRedactOptions: false,
            showTypeOptions: true
        }
    };

    let currentTool = 'merge';
    let splitDownloadResolver = null;
    let filesLoading = false;

    const applyToolUI = () => {
        const config = toolConfig[currentTool];
        currentToolTitle.textContent = config.title;
        currentToolDesc.textContent = config.description;
        dropzoneTitle.textContent = config.dropzoneTitle;
        dropzoneSubtitle.textContent = config.dropzoneSubtitle;
        processBtn.innerHTML = config.processLabel;
        fileInput.multiple = config.multiple;
        splitOptions.classList.toggle('hidden', !config.showSplitOptions);
        if (mergeOptions) {
            mergeOptions.classList.toggle('hidden', !config.showMergeOptions);
        }
        if (redactOptions) {
            redactOptions.classList.toggle('hidden', !config.showRedactOptions);
        }
        if (typeOptions) {
            typeOptions.classList.toggle('hidden', !config.showTypeOptions);
        }
    };
    
    const closeSplitDownloadModal = (choice = null) => {
        if (splitDownloadResolver) {
            splitDownloadResolver(choice);
            splitDownloadResolver = null;
        }
        splitDownloadModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    };

    const openSplitDownloadModal = () => {
        if (splitDownloadResolver) {
            splitDownloadResolver(null);
            splitDownloadResolver = null;
        }

        splitDownloadModal.classList.remove('hidden');
        document.body.classList.add('modal-open');
        splitZipBtn.focus();

        return new Promise((resolve) => {
            splitDownloadResolver = resolve;
        });
    };

    const downloadSplitAsZip = async (splitParts, sourceFileName) => {
        if (typeof JSZip === 'undefined') {
            throw new Error('ZIP library failed to load. Please refresh and try again.');
        }

        const zip = new JSZip();
        splitParts.forEach((part) => {
            zip.file(part.name, part.bytes);
        });

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const baseName = sourceFileName.replace(/\.pdf$/i, '') || 'split_document';
        saveAs(zipBlob, `${baseName}_split.zip`);
    };

    const downloadSplitIndividually = (splitParts) => {
        splitParts.forEach((part, index) => {
            const splitBlob = new Blob([part.bytes], { type: 'application/pdf' });
            setTimeout(() => {
                saveAs(splitBlob, part.name);
            }, index * 150);
        });
    };

    const setTool = (toolName) => {
        if (!toolConfig[toolName] || toolName === currentTool) return;
        if (filesLoading) {
            alert('Please wait until files finish loading.');
            return;
        }

        currentTool = toolName;
        toolButtons.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tool === toolName);
        });

        closeSplitDownloadModal();
        setUIMode(currentTool);
        clearFiles();
        splitRangesInput.value = '';
        applyToolUI();
    };

    toolButtons.forEach((btn) => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    splitZipBtn.addEventListener('click', () => closeSplitDownloadModal('zip'));
    splitAllBtn.addEventListener('click', () => closeSplitDownloadModal('all'));
    splitCancelBtn.addEventListener('click', () => closeSplitDownloadModal());

    splitDownloadModal.addEventListener('click', (event) => {
        if (event.target === splitDownloadModal) {
            closeSplitDownloadModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !splitDownloadModal.classList.contains('hidden')) {
            closeSplitDownloadModal();
        }
    });

    splitRangesInput.addEventListener('input', (e) => {
        updateSplitSelectionFromInput(e.target.value);
    });

    // --- Files Handling ---
    const handleFiles = async (newFiles) => {
        if (filesLoading) {
            alert('Please wait until files finish loading.');
            return;
        }

        // Validation: PDF only
        const validFiles = Array.from(newFiles).filter(f => f.type === 'application/pdf');
        
        if (validFiles.length === 0) {
             alert("Please upload valid PDF files.");
             return;
        }

        filesLoading = true;
        setLoadingState(true, currentTool === 'merge' ? 'Loading PDF pages...' : 'Loading PDF file...');

        try {
            if (currentTool === 'merge') {
                await updateFileList(validFiles, ({ index, total, fileName }) => {
                    setLoadingState(true, `Loading ${index + 1}/${total}: ${fileName}`);
                });
                return;
            }

            // Split/Redact/Type mode: keep one source PDF.
            clearFiles();
            await updateFileList([validFiles[0]]);
            if (validFiles.length > 1) {
                alert(`${currentTool.charAt(0).toUpperCase() + currentTool.slice(1)} mode uses one source file. Using the first selected PDF.`);
            }
        } finally {
            filesLoading = false;
            setLoadingState(false);
        }
    };

    // Dropzone Events
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });
    
    dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        try {
            await handleFiles(e.dataTransfer.files);
        } catch (error) {
            console.error(error);
            alert(error.message || 'Failed to load PDF previews.');
        }
    });

    fileInput.addEventListener('change', async (e) => {
        try {
            await handleFiles(e.target.files);
        } catch (error) {
            console.error(error);
            alert(error.message || 'Failed to load PDF previews.');
        }

        // Reset input so same file selection works again
        fileInput.value = '';
    });

    // --- Buttons ---
    clearBtn.addEventListener('click', () => {
        clearFiles();
    });

    processBtn.addEventListener('click', async () => {
        const files = getFiles();
        let splitDownloadMode = null;
        const mergeSelection = getMergeSelection();

        if (currentTool === 'merge' && mergeSelection.pages.length < 2) {
            alert('Please attach PDFs with at least 2 pages total to merge.');
            return;
        }

        if (currentTool === 'split' && files.length !== 1) {
            alert('Please select one PDF file to split.');
            return;
        }

        if (currentTool === 'redact') {
            const redactionData = getRedactionData();
            if (redactionData.areas.length === 0) {
                alert('Please select at least one area to redact. Click and drag on page thumbnails to mark areas.');
                return;
            }
        }

        if (currentTool === 'split') {
            splitDownloadMode = await openSplitDownloadModal();
            if (!splitDownloadMode) {
                return;
            }
        }

        processBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
        processBtn.disabled = true;

        try {
            if (currentTool === 'merge') {
                const mergedPdfBytes = await mergePDFPages(mergeSelection);
                const mergedBlob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
                const filename = (mergeFilenameInput?.value.trim() || 'merged_document') + '.pdf';
                saveAs(mergedBlob, filename);
            } else if (currentTool === 'redact') {
                const redactionData = getRedactionData();
                const redactedPdfBytes = await applyRedactions(redactionData.bytes, redactionData.areas);
                const redactedBlob = new Blob([redactedPdfBytes], { type: 'application/pdf' });
                const baseName = files[0]?.name?.replace(/\.pdf$/i, '') || 'document';
                saveAs(redactedBlob, `${baseName}_redacted.pdf`);
                clearRedactionAreas();
                alert('Redaction applied successfully. Sensitive content has been permanently removed.');
            } else if (currentTool === 'type') {
                const typeData = getTypeData();
                const modifiedPdfBytes = await addTextToPDF(files[0], typeData);
                const modifiedBlob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
                const baseName = files[0]?.name?.replace(/\.pdf$/i, '') || 'document';
                saveAs(modifiedBlob, `${baseName}_filled.pdf`);
                // clearTypeData(); // Optional: keep data for more edits?
                alert('PDF saved successfully with added text.');
            } else {
                const splitParts = await splitPDF(files[0], splitRangesInput.value);
                if (splitDownloadMode === 'zip') {
                    await downloadSplitAsZip(splitParts, files[0].name);
                    alert(`Created ZIP with ${splitParts.length} split file(s).`);
                } else {
                    downloadSplitIndividually(splitParts);
                    alert(`Created ${splitParts.length} split file(s).`);
                }
            }
            
        } catch (error) {
            console.error(error);
            alert(error.message || 'An error occurred while processing the PDF.');
        } finally {
            processBtn.innerHTML = toolConfig[currentTool].processLabel;
            processBtn.disabled = false;
        }
    });

    // --- Theme Toggle ---
    
     themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    // --- App Launcher Modal ---
    const appLauncherBtn = document.getElementById('app-launcher-btn');
    const appLauncherModal = document.getElementById('app-launcher-modal');
    const appLauncherCloseBtn = document.getElementById('app-launcher-close');
    const appLauncherIframe = document.getElementById('app-launcher-iframe');
    const appLauncherBackdrop = appLauncherModal ? appLauncherModal.querySelector('.modal-backdrop') : null;
    let bodyOverflowBeforeOpen = '';

    const openAppLauncher = () => {
        if (!appLauncherIframe.getAttribute('src')) {
             appLauncherIframe.setAttribute('src', appLauncherIframe.dataset.src || 'https://open-edit.netlify.app/apps.html');
        }
        bodyOverflowBeforeOpen = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        appLauncherModal.classList.remove('hidden');
        appLauncherBtn.setAttribute('aria-expanded', 'true');
    };

    const closeAppLauncher = () => {
        appLauncherModal.classList.add('hidden');
        appLauncherBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = bodyOverflowBeforeOpen;
    };

    if (appLauncherBtn && appLauncherModal) {
        appLauncherBtn.addEventListener('click', (e) => {
             e.stopPropagation();
             if (appLauncherModal.classList.contains('hidden')) {
                 openAppLauncher();
             } else {
                 closeAppLauncher();
             }
        });

        if (appLauncherCloseBtn) {
            appLauncherCloseBtn.addEventListener('click', closeAppLauncher);
        }

        if (appLauncherBackdrop) {
           appLauncherBackdrop.addEventListener('click', closeAppLauncher);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !appLauncherModal.classList.contains('hidden')) {
                closeAppLauncher();
            }
        });
    }

    // Load saved theme
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
        document.body.classList.add('dark-mode');
    }

    setUIMode(currentTool);
    applyToolUI();
});
