// Word (.docx) and HTML files → Markdown. Images of a .docx are saved next to the new note.
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const Html2Md = require('./src/html2md');

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/tiff': 'tiff' };
const IMPORT_RE = /\.(docx|html?|xhtml)$/i;

// File-name part for saved images: no spaces, so the Markdown link needs no escaping.
const slug = (s) => String(s || 'note').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'note';

// Returns { markdown, images } — `outFile` is where the note will be written (images go in its folder).
async function convertFile(file, outFile) {
  if (/\.docx$/i.test(file)) {
    const outDir = path.dirname(outFile);
    const stem = slug(path.basename(outFile).replace(/\.[^.]+$/, ''));
    let images = 0;
    const result = await mammoth.convertToHtml(
      { path: file },
      {
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
        convertImage: mammoth.images.imgElement(async (image) => {
          const ext = IMAGE_TYPES[image.contentType] || 'png';
          const name = `${stem}-image-${++images}.${ext}`;
          await fs.promises.writeFile(path.join(outDir, name), await image.readAsBuffer());
          return { src: encodeURI(name) };
        }),
      }
    );
    return { markdown: Html2Md.toMarkdown(result.value), images };
  }
  return { markdown: Html2Md.toMarkdown(await fs.promises.readFile(file, 'utf8')), images: 0 };
}

module.exports = { convertFile, IMPORT_RE };
