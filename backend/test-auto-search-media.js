const assert = require('assert');
const AdmZip = require('adm-zip');
const { extractDocumentText, shortLinks, messageContentType } = require('./src/api/services/AutoSearchService');

(async () => {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>انضم هنا</w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>الرابط</w:t></w:r></w:hyperlink></w:p></w:body></w:document>'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Target="https://chat.whatsapp.com/AbCdEfGhIjK" TargetMode="External"/></Relationships>'));
  const text = await extractDocumentText(zip.toBuffer(), 'links.docx');
  assert(text.includes('https://chat.whatsapp.com/AbCdEfGhIjK'));
  assert.deepStrictEqual(shortLinks('رابط https://bit.ly/example'), ['https://bit.ly/example']);
  assert.strictEqual(messageContentType({ message: { imageMessage: {} } }), 'image');
  console.log('auto-search media helpers: ok');
})();
