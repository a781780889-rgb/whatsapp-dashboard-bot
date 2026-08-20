'use strict';

const AdmZip = require('adm-zip');
const service = require('./LinkImportService');

test('extracts and normalizes WhatsApp invite links from a real DOCX container', () => {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<w:document><w:p>https://chat.whatsapp.com/ABC123</w:p><w:p>https://chat.whatsapp.com/ABC123، https://chat.whatsapp.com/XYZ789</w:p></w:document>'));
  const links = service.parseDocx(zip.toBuffer(), 'links.docx');
  const parsed = service.parseImportedLinks(links);
  expect(links).toHaveLength(3);
  expect(parsed.valid.map(item => item.canonicalUrl)).toEqual(['https://chat.whatsapp.com/ABC123', 'https://chat.whatsapp.com/XYZ789']);
  expect(parsed.duplicateInFile).toBe(1);
});

test('rejects legacy .doc rather than guessing a parser', () => {
  expect(() => service.parseDocx(Buffer.from('not-a-doc'), 'links.doc')).toThrow('docx');
});

test('separates unsupported and malformed links for review metrics', () => {
  const parsed = service.parseImportedLinks([
    'https://example.com/group',
    'https://chat.whatsapp.com/no',
  ]);
  expect(parsed.review).toHaveLength(1);
  expect(parsed.invalid).toHaveLength(1);
});
