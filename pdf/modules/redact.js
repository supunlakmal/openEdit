/**
 * PDF Redaction Module
 * Implements "True Redaction" using page reconstruction approach.
 * Text is permanently removed, not just visually masked.
 */

/* global PDFLib, pdfjsLib */

/**
 * Normalize screen pixel coordinates to PDF points.
 * @param {Object} pixelRect - {x, y, width, height} in screen pixels
 * @param {Object} canvasSize - {width, height} of the canvas
 * @param {Object} pageSize - {width, height} of the PDF page in points
 * @returns {Object} - {x, y, width, height} in PDF points
 */
export function normalizeCoordinates(pixelRect, canvasSize, pageSize) {
    const scaleX = pageSize.width / canvasSize.width;
    const scaleY = pageSize.height / canvasSize.height;
    
    return {
        x: pixelRect.x * scaleX,
        // PDF Y coordinates start from bottom, canvas from top
        y: pageSize.height - (pixelRect.y + pixelRect.height) * scaleY,
        width: pixelRect.width * scaleX,
        height: pixelRect.height * scaleY
    };
}

/**
 * Sanitize PDF metadata to remove identifying information.
 * @param {PDFDocument} pdfDoc - pdf-lib PDFDocument instance
 */
function sanitizeMetadata(pdfDoc) {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('');
    pdfDoc.setCreator('');
}

/**
 * Apply redactions to a PDF by reconstructing pages with redacted areas as images.
 * This ensures text is permanently removed, not just visually hidden.
 * 
 * @param {Uint8Array} pdfBytes - Original PDF bytes
 * @param {Array} redactionAreas - Array of {pageIndex, rect: {x, y, width, height}}
 *                                  where rect is in screen pixels relative to thumbnail
 * @returns {Promise<Uint8Array>} - Redacted PDF bytes
 */
export async function applyRedactions(pdfBytes, redactionAreas) {
    if (!window.PDFLib) {
        throw new Error('PDF library not loaded. Please refresh and try again.');
    }
    
    const { PDFDocument, rgb } = PDFLib;
    
    // Group redactions by page
    const redactionsByPage = new Map();
    redactionAreas.forEach(area => {
        if (!redactionsByPage.has(area.pageIndex)) {
            redactionsByPage.set(area.pageIndex, []);
        }
        redactionsByPage.get(area.pageIndex).push(area);
    });
    
    // Load source PDF
    const sourcePdf = await PDFDocument.load(pdfBytes);
    const pageCount = sourcePdf.getPageCount();
    
    // Create new PDF for output
    const outputPdf = await PDFDocument.create();
    
    // Process each page
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const sourcePage = sourcePdf.getPage(pageIndex);
        const { width, height } = sourcePage.getSize();
        
        if (redactionsByPage.has(pageIndex)) {
            // This page has redactions - render to image and redact
            const redactedImageBytes = await renderPageWithRedactions(
                pdfBytes, 
                pageIndex, 
                redactionsByPage.get(pageIndex),
                { width, height }
            );
            
            // Embed the redacted image
            const redactedImage = await outputPdf.embedPng(redactedImageBytes);
            
            // Create new page with same dimensions
            const newPage = outputPdf.addPage([width, height]);
            
            // Draw the redacted image to fill the entire page
            newPage.drawImage(redactedImage, {
                x: 0,
                y: 0,
                width: width,
                height: height
            });
        } else {
            // No redactions - copy page directly
            const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageIndex]);
            outputPdf.addPage(copiedPage);
        }
    }
    
    // Sanitize metadata
    sanitizeMetadata(outputPdf);
    
    return outputPdf.save();
}

/**
 * Render a PDF page to canvas with redaction rectangles applied.
 * @param {Uint8Array} pdfBytes - Original PDF bytes
 * @param {number} pageIndex - Page index (0-based)
 * @param {Array} redactions - Redaction areas for this page
 * @param {Object} pageSize - {width, height} in PDF points
 * @returns {Promise<Uint8Array>} - PNG image bytes
 */
async function renderPageWithRedactions(pdfBytes, pageIndex, redactions, pageSize) {
    if (!window.pdfjsLib) {
        throw new Error('PDF.js library not loaded. Please refresh and try again.');
    }
    
    // Load PDF with pdf.js for rendering
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(pageIndex + 1); // pdf.js uses 1-based indexing
    
    // Use higher scale for better quality (2x)
    const scale = 2;
    const viewport = page.getViewport({ scale });
    
    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    
    // Fill with white background
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Render the PDF page
    await page.render({ canvasContext: context, viewport }).promise;
    
    // Draw black rectangles over redacted areas
    context.fillStyle = '#000000';
    
    redactions.forEach(redaction => {
        const { rect, canvasWidth, canvasHeight } = redaction;
        
        // Calculate scaling factor from the UI canvas to this render canvas
        let scaleX, scaleY;
        
        if (canvasWidth && canvasHeight) {
             // UI Canvas -> Render Canvas
             scaleX = canvas.width / canvasWidth;
             scaleY = canvas.height / canvasHeight;
        } else {
             // Fallback if dimensions missing (assume default thumbnail scale 0.22)
             const thumbScale = 0.22;
             const adjustedScale = scale / thumbScale;
             scaleX = adjustedScale;
             scaleY = adjustedScale;
        }
        
        context.fillRect(
            rect.x * scaleX,
            rect.y * scaleY,
            rect.width * scaleX,
            rect.height * scaleY
        );
    });
    
    // Convert canvas to PNG
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Cleanup
    if (typeof page.cleanup === 'function') {
        page.cleanup();
    }
    if (typeof pdfDoc.destroy === 'function') {
        await pdfDoc.destroy();
    }
    
    return bytes;
}
