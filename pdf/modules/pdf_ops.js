/* global PDFLib */

export async function mergePDFs(files) {
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const sourcePdf = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    return mergedPdf.save();
}

export async function mergePDFPages(mergePlan) {
    const { PDFDocument } = PDFLib;

    const files = Array.isArray(mergePlan?.files) ? mergePlan.files : [];
    const pages = Array.isArray(mergePlan?.pages) ? mergePlan.pages : [];

    if (files.length === 0 || pages.length === 0) {
        throw new Error('No pages found to merge.');
    }

    const sourceById = new Map(files.map((file) => [file.id, file]));
    const loadedPdfs = new Map();
    const mergedPdf = await PDFDocument.create();

    for (const page of pages) {
        const sourceFile = sourceById.get(page.fileId);
        if (!sourceFile) {
            throw new Error('Invalid merge plan: missing source file.');
        }

        let sourcePdf = loadedPdfs.get(page.fileId);
        if (!sourcePdf) {
            sourcePdf = await PDFDocument.load(sourceFile.bytes);
            loadedPdfs.set(page.fileId, sourcePdf);
        }

        const [copiedPage] = await mergedPdf.copyPages(sourcePdf, [page.pageIndex]);
        mergedPdf.addPage(copiedPage);
    }

    return mergedPdf.save();
}

function parseSplitRanges(rangesInput, pageCount) {
    const rawInput = rangesInput.trim();

    // Default split mode: one file per page.
    if (!rawInput) {
        return Array.from({ length: pageCount }, (_, index) => [index]);
    }

    return rawInput
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!match) {
                throw new Error(`Invalid range "${part}". Use values like 3 or 2-5.`);
            }

            const start = Number(match[1]);
            const end = Number(match[2] || match[1]);

            if (start > end) {
                throw new Error(`Invalid range "${part}". Start page must be <= end page.`);
            }

            if (start < 1 || end > pageCount) {
                throw new Error(`Range "${part}" is outside the document (1-${pageCount}).`);
            }

            return Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset);
        });
}

function getBaseName(fileName) {
    return fileName.replace(/\.pdf$/i, '') || 'document';
}

export async function splitPDF(file, rangesInput = '') {
    const { PDFDocument } = PDFLib;

    const arrayBuffer = await file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(arrayBuffer);
    const pageCount = sourcePdf.getPageCount();

    if (pageCount === 0) {
        throw new Error('The selected PDF has no pages.');
    }

    const pageGroups = parseSplitRanges(rangesInput, pageCount);
    const baseName = getBaseName(file.name);
    const results = [];

    for (let i = 0; i < pageGroups.length; i++) {
        const pageIndices = pageGroups[i];
        const splitDoc = await PDFDocument.create();
        const copiedPages = await splitDoc.copyPages(sourcePdf, pageIndices);
        copiedPages.forEach((page) => splitDoc.addPage(page));

        const startPage = pageIndices[0] + 1;
        const endPage = pageIndices[pageIndices.length - 1] + 1;
        const suffix = startPage === endPage ? `p${startPage}` : `p${startPage}-${endPage}`;

        results.push({
            name: `${baseName}_${suffix}.pdf`,
            bytes: await splitDoc.save()
        });
    }

    return results;
}
